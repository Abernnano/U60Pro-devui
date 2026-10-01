"""Assemble and verify the offline beta package from the known source tree.
No filesystem discovery outside this project; no downloads and no router I/O.
"""
from pathlib import Path
import gzip, hashlib, io, json, re, struct, subprocess, tarfile
ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT/'local-assets/u60pro-screen-ui-v1.0.0'
SRC=PROJECT/'runtime-src'
OUT=ROOT/'v1.2.13_beta'
DEPS=ROOT/'local-assets/screen-build'
VERSION='1.2.13-beta.3'
DATE='2026-09-28'
OUT.mkdir(exist_ok=True)
def digest(data): return hashlib.sha256(data).hexdigest()
def elf_check(data, static=False):
    assert data[:7]==b'\x7fELF\x02\x01\x01', 'Not little-endian ELF64'
    assert struct.unpack_from('<H',data,18)[0]==183, 'Not AArch64'
    phoff=struct.unpack_from('<Q',data,32)[0]
    entsize,count=struct.unpack_from('<HH',data,54)
    assert phoff+entsize*count<=len(data), 'Truncated ELF program headers'
    assert not static or all(struct.unpack_from('<I',data,phoff+i*entsize)[0]!=3 for i in range(count)), 'Unexpected dynamic interpreter'
def archive(files):
    buf=io.BytesIO()
    with gzip.GzipFile(fileobj=buf,mode='wb',filename='',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w',format=tarfile.USTAR_FORMAT) as t:
            for name,data in sorted(files.items()):
                assert not name.startswith('/') and '..' not in Path(name).parts
                i=tarfile.TarInfo(name);i.size=len(data);i.mode=0o755 if name.endswith('.sh') else 0o644
                t.addfile(i,io.BytesIO(data))
    return buf.getvalue()
def put(name,data):
    p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(data.encode('utf-8') if isinstance(data,str) else data)
    return p
renderer=(SRC/'u60pro-devui.stripped').read_bytes()
elf_check(renderer,static=True)
put('u60pro-devui-aarch64', renderer)
assert (OUT/'u60pro-devui-aarch64').read_bytes()==renderer
for token in [b'SIGNALQUALITY',b'mhstart',b'mhstop',b'mhrestart',b'--mihomo-control',b'/data/plugins/U60Proxy', b'U60_SCREEN_BETA_3', b'CHARGELIMIT', b'chargelimit:', b'day_rx_bytes']:
    assert token in renderer, ('Missing compiled feature',token)
elf_check((OUT/'zwrt-datad-aarch64').read_bytes())
put('u60\u5c4f\u5e55\u7ba1\u7406.js',(ROOT/'u60\u5c4f\u5e55\u7ba1\u7406.js').read_bytes())
subprocess.run(['node','--check',str(OUT/'u60\u5c4f\u5e55\u7ba1\u7406.js')],check=True)
manifest=(PROJECT/'ui/.devui-managed-files').read_text(encoding='utf-8').splitlines()
assert len(manifest)==len(set(manifest)) and all(manifest)
ui={name:(PROJECT/'ui'/name).read_bytes() for name in manifest}
ui['.devui-managed-files']=('\n'.join(manifest)+'\n').encode()
for name in ['01-signal.html','02-functions.html','functions/clash.html','subpages/cell.html','subpages/wifi.html','style.css','functions/wifi-power-save.html','functions/sim-traffic.html']:
    assert name in ui
assert b'{{SIGNALQUALITY}}' in ui['01-signal.html'] and b'{{SIGNALQUALITY}}' in ui['subpages/cell.html']
assert b'SIGNALQUALITY' not in ui['subpages/wifi.html']
# All template tokens and navigation targets must be supplied by this release.
htmlmain=(SRC/'src/htmlmain.c').read_text(encoding='utf-8')
tokens=set(re.findall(r'{ "([A-Z0-9_]+)",',htmlmain))
for name,data in ui.items():
    if not name.endswith(('.html','.css')): continue
    text=data.decode('utf-8')
    assert '\ufffd' not in text and '???' not in text, ('Corrupt UI text',name)
    if name.endswith('.html'):
        unknown=set(re.findall(r'{{([A-Z0-9_]+)}}',text))-tokens
        assert not unknown, ('Unknown template tokens',name,unknown)
        for kind,target in re.findall(r'act:(sub|func):([^"\s<>]+)',text):
            assert ('subpages/' if kind=='sub' else 'functions/')+target in ui, ('Missing page',name,target)
assert all(x in ui['functions/wifi-power-save.html'] for x in [b'act:chargelimit:', b'act:chargeauto',b'act:dpson'])

for action in [b'act:mhstart',b'act:mhstop',b'act:mhrestart',b'act:mhrefresh']:
    assert action in ui['functions/clash.html']
with tarfile.open(ROOT/'local-assets/u60pro-screen-ui-v1.0.0-source.tar.gz') as original:
    assert original.extractfile('ui/subpages/wifi.html').read()==ui['subpages/wifi.html'], 'Wi-Fi unexpectedly modified'
    full_source={m.name:(PROJECT/m.name).read_bytes() for m in original.getmembers() if m.isfile()}
blob=archive(ui)
put('ui.tar.gz',blob);put('ui-full.tar.gz',blob)
patches=['src/htmlmain.c','src/data.c','include/data.h','include/signal_quality.h','include/mihomo_control.h','include/battery_config.h','include/traffic_stats.h',
         'scripts/build-windows.py','tests/regression.c','tests/reference-vectors.h']
for rel in patches:
    data=(SRC/rel).read_bytes();put('source-patch/'+rel,data);full_source['runtime-src/'+rel]=data
for name,data in ui.items(): put('source-patch/ui/'+name,data);full_source['ui/'+name]=data
for name in ['test-beta.py','test-install.py','package-beta.py']:
    data=(ROOT/'build-tools'/name).read_bytes();put('source-patch/build-tools/'+name,data)
    full_source['beta-build-tools/'+name]=data
full_source['beta-build-tools/fixtures/signal-reference-decoded.js']=(DEPS/'signal-reference-decoded.js').read_bytes()
full_source['u60屏幕管理.js']=(ROOT/'u60屏幕管理.js').read_bytes()
for name in ['LICENSE','NOTICE.md']:
    put(name,(PROJECT/name).read_bytes())
put('NOTICE.md', '# Beta distribution note\n\nThe upstream notice below describes the original v1.0.0 source release. This beta additionally includes the existing screen management script and unchanged zwrt-datad binary supplied in this workspace, together with the modified renderer and UI. No Mihomo core, subscription, device credentials or private router configuration is included.\n\n---\n\n'+(PROJECT/'NOTICE.md').read_text(encoding='utf-8'))
for name in ['FreeType-FTL.TXT','gumbo-LICENSE','litehtml-LICENSE','stb-LICENSE']:
    put('licenses/'+name,(PROJECT/'licenses'/name).read_bytes())
for src,name in [('lib/libc/musl/COPYRIGHT','musl-COPYRIGHT'),('lib/libcxx/LICENSE.TXT','libcxx-LICENSE.TXT'),
                 ('lib/libcxxabi/LICENSE.TXT','libcxxabi-LICENSE.TXT'),('LICENSE','Zig-LICENSE')]:
    p=DEPS/'zig-x86_64-windows-0.14.1'/src
    if p.is_file(): put('licenses/'+name,p.read_bytes())
readme="# U60 Pro 屏幕 UI · 1.2.13-beta.3\n\n基于 huangtengsz-ui/u60pro-screen-ui v1.0.0。发布目录仍为 v1.2.13_beta，内含本次重新编译的 ARM64 静态程序。\n\n## 安装本次修复\n\n1. 在网页插件导入入口替换本目录的 u60屏幕管理.js，重新打开屏幕管理。\n2. 在“本地安装”中同时选择 u60pro-devui-aarch64、ui.tar.gz、version.json，点击“上传并安装本地文件”。也可选择整个发布目录，脚本会识别所需文件。\n3. 等待程序替换、校验和屏幕服务重启。数据服务已正常运行时不用更新 zwrt-datad-aarch64；首次安装或缺失数据服务时再一起选择它。\n4. 从“常用功能”进入“流量”或“WiFi 与供电”。上滑可查看自动直供和手动直供设置。\n\nUI 和渲染程序必须配套更新。仅替换 HTML 无法修复旧程序的流量入口拦截，也无法增加电量控制动作。带 version.json 的本地上传会检查程序标记，发现旧程序时在切换页面前报错。\nui-full.tar.gz 与 ui.tar.gz 内容相同，二选一即可；source.tar.gz、source-patch、许可证和测试文件无需导入路由器。\n\n## 本次修复\n\n- 修复 WiFi 节能页及入口的问号文本，统一 UTF-8 编码。按 320×480 小屏重排卡片，增加可点击的大按钮和明暗主题。\n- 流量页不再因后端缺少按卡套餐接口而被当作不存在。支持设备原生日/月字段以及按卡数据，列出上传、下载和合计；未返回的计数显示 --。设备统计的月结日和时区由固件定义；按卡后端显示套餐周期。\n- 充电上限可在 10–100% 之间以 1% 或 5% 调整，恢复回差为 1–20%。启用充电保护与自动直供后，例如上限 80%、回差 5%，达到 80% 自动直供，降到 75% 恢复充电。\n- 百分比策略使用已安装的“直供电和充电器电池监控”插件。实际配置文件为 /data/plugins/battery_monitor/battery_monitor.conf；后台约每 2 秒读取。屏幕关闭后仍由该插件后台执行，开机运行依赖原插件自启设置。\n- 修复 Shell 电池监控被误判为停止：核对 PID 对应的完整脚本参数。插件缺失、配置损坏、后台停止分别提示。此包不会安装第二套充电后台。\n- 手动直供与自动直供互斥；手动关闭直供时保留充电保护。电池插件未安装时，手动直供使用厂商接口，不能提供按百分比策略。\n- 配置更新保留未知字段（包括充电限流），使用屏幕写入锁、临时文件、刷盘与原子替换；发现其他写入会拒绝覆盖。原网页插件不共享此锁，请避免同时从两端修改同一配置。\n- 修复打包脚本未复制新渲染器的问题，发布程序与版本清单校验和一致。源码包包含本次新增头文件和测试。\n\n## 保留的功能\n\n信号综合评分位于信号和基站页。透明代理保留真实启动、停止、重启和刷新控制；没有重新添加此前要求撤回的策略组、节点或数据维护栏。\n\n## 验证范围\n\n本次通过 ARM64 交叉编译、397 项 C 回归、11 项隔离安装用例、JS 语法与发布包一致性检查。安装测试覆盖新增页面、旧受管文件清理、用户文件保留及异常压缩包拒绝。\n尚未连接实体路由器，未验证实机触摸、充电硬件行为或长期无人值守运行。测试详情见 TEST-RESULTS.json。\n\n## 源码与许可\n\nsource.tar.gz 包含完整 UI/渲染器源码，source-patch 提供改动文件和构建工具。数据服务 zwrt-datad-aarch64 沿用现有文件。第三方声明见 NOTICE.md、LICENSE 和 licenses。\n"
put('README.md',readme)
building="# Beta 构建说明\n\n从项目根目录运行：\n\n    python -X utf8 ./build-tools/test-beta.py\n    python -X utf8 ./build-tools/test-install.py\n    python -X utf8 ./local-assets/u60pro-screen-ui-v1.0.0/runtime-src/scripts/build-windows.py\n    python -X utf8 ./build-tools/package-beta.py\n\n依赖已在 local-assets/screen-build 中：Zig 0.14.1、FreeType 2.13.3、litehtml 0.10；构建不联网下载。Linux 回归测试使用现有 docker-desktop WSL，仅在独立 /tmp/devui-* 目录运行测试夹具，不连接路由器。\n\nsource-patch 的 src、include、scripts、tests 覆盖 runtime-src 对应目录，ui 覆盖 UI 目录。source.tar.gz 内 beta-build-tools 对应项目 build-tools；还包含信号评分参考算法 fixture。回归通过后重新编译，再打包。\n\n编译缓存包含头文件摘要。打包校验程序功能标记、全部模板 token、页面链接目标、UTF-8 与问号乱码，复制最新渲染器并核对其 SHA-256；缺失或陈旧产物会中止打包。\n"
put('source-patch/BUILDING-BETA.md',building);full_source['BUILDING-BETA.md']=building.encode()
put('source.tar.gz',archive(full_source))
version={'schema':1,'release':VERSION,'buildDate':DATE,'baseProject':'huangtengsz-ui/u60pro-screen-ui','baseVersion':'1.0.0',
 'devui':{'version':VERSION,'asset':'u60pro-devui-aarch64','sha256':digest(renderer),'notes':'Compiled beta.3 renderer; ELF64 AArch64 static musl.'},
 'ui':{'version':VERSION,'requiredRendererMarker':'U60_SCREEN_BETA_3','asset':'ui.tar.gz','sha256':digest(blob),'notes':'Install with the renderer from this package; adds traffic summaries and WiFi power/direct-supply controls.'},
 'datad':{'asset':'zwrt-datad-aarch64','sha256':digest((OUT/'zwrt-datad-aarch64').read_bytes()),'unchanged':True,'notes':'Existing paired data service; unchanged.'},
 'validation':{'cChecks':397,'installerCases':11,'hardwareVerified':False,'longTermSoakVerified':False}}
put('version.json',json.dumps(version,ensure_ascii=False,indent=2)+'\n')
report={'buildDate':DATE,'runtimeArchitecture':'ELF64 AArch64','runtimeStatic':True,'featuresCompiled':True,
        'compilerWarnings':(DEPS/'out/app_htmlmain.log').read_text(encoding='utf-8').count('warning:'),
        'wifiUnchangedFromReleaseArchive':True,'wifiSha256':digest(ui['subpages/wifi.html']),
        'uiManagedFiles':len(manifest),'uiArchivesIdentical':True,
        'cRegression':(DEPS/'beta-test-results.txt').read_text(encoding='utf-8'),
        'installerIntegration':(DEPS/'install-test-results.txt').read_text(encoding='utf-8'),
        'hardwareVerified':False,'longTermSoakVerified':False}
assert 'PASS 397 checks' in report['cRegression'] and 'PASS 11 installer' in report['installerIntegration']
put('TEST-RESULTS.json',json.dumps(report,ensure_ascii=False,indent=2)+'\n')
# Only inventory the deliverable directory to produce its checksum manifest.
checks=[]
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name!='SHA256SUMS.txt': checks.append(digest(p.read_bytes())+'  '+p.relative_to(OUT).as_posix())
put('SHA256SUMS.txt','\n'.join(checks)+'\n')
for line in checks:
    h,name=line.split('  ',1);assert digest((OUT/name).read_bytes())==h
print('PACKAGE-OK',OUT)
print('RUNTIME-SHA256',digest(renderer))
print('UI-SHA256',digest(blob))
print('CHECKSUM-FILES',len(checks),'UI-MANAGED-FILES',len(manifest))
print('WIFI-UNCHANGED',digest(ui['subpages/wifi.html']))

