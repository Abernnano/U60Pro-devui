//<script>
(async () => {
    // === U60Pro DevUI 管理插件 (三组件分别更新 / 源可选 GitHub|网盘1|网盘2|自定义源链接) ===
    // 三个组件各自版本、可单独或一键更新:
    //   - 后端 datad  (zwrt-datad)        →  /data/plugins/zwrt-datad/zwrt-datad
    //   - 渲染器 devui (u60pro-devui)      →  /data/plugins/u60pro-devui/u60pro-devui
    //   - UI 界面 ui  (u60pro-devui/ui)    →  页面、二级页面与 functions 控制页
    // 版本判定: 读各项目 latest release 里的 version.json
    //   - devui repo 的 version.json 含 { devui:{version,asset}, ui:{version,asset} }
    //   - datad repo 的 version.json 含 { datad:{version,asset} }
    // 更新源: GitHub(自动检测本机 Mihomo 7890，代理失败回退直连)、网盘1/网盘2 或自定义源链接
    // 自启: 直接写 /etc/rc.local, datad/devui 分别由独立脚本启动 (不走 ufi_tools_boot.sh)

    const PLUGIN_NAME = 'U60DevUI'
    const LOG = (...a) => console.log(`[${PLUGIN_NAME}]`, ...a)
    const MODAL_ID = 'U60DevUIModal_plugin'
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const bootToast = (message, color = 'red', timeout = 5000) => {
        try { createToast(String(message || ''), color || '', timeout || 2500) }
        catch (e) {
            try { alert(String(message || '')) } catch (ee) {}
        }
    }
    const waitForBody = async () => {
        for (let i = 0; i < 100; i++) {
            if (document.body) return
            await wait(100)
        }
        throw new Error('页面主体未就绪')
    }
    let openBtn = null
    let openHandler = async () => bootToast('插件仍在初始化，请稍候再试', 'pink', 2500)
    const mountOpenButton = async () => {
        await waitForBody()
        if (!openBtn) {
            openBtn = document.createElement('button')
            openBtn.textContent = '屏幕管理'
            openBtn.onclick = () => openHandler()
        }
        if (openBtn.isConnected) return openBtn
        for (let i = 0; i < 100; i++) {
            const slot = (typeof collapseBtn_menu !== 'undefined' && collapseBtn_menu)
                ? collapseBtn_menu.nextElementSibling?.querySelector('.collapse_box')
                : null
            if (slot) {
                slot.appendChild(openBtn)
                return openBtn
            }
            const actions = document.querySelector('.functions-container .actions-buttons')
            if (actions) {
                actions.appendChild(openBtn)
                return openBtn
            }
            await wait(100)
        }
        throw new Error('插件按钮挂载位置未就绪')
    }
    const showBootFallback = async (message) => {
        try {
            await waitForBody()
            if (document.getElementById('u60_devui_boot_error_btn')) return
            const btn = document.createElement('button')
            btn.id = 'u60_devui_boot_error_btn'
            btn.textContent = '屏幕管理'
            btn.style.cssText = [
                'position:fixed',
                'right:14px',
                'bottom:14px',
                'z-index:100000',
                'padding:10px 14px',
                'border-radius:10px',
                'border:none',
                'background:#7a3a1a',
                'color:#fff',
                'box-shadow:0 6px 18px rgba(0,0,0,.28)'
            ].join(';')
            btn.onclick = () => {
                try { createToast(`屏幕管理插件加载异常: ${message}`, 'red', 7000) }
                catch (e) { alert(`屏幕管理插件加载异常:\n${message}`) }
            }
            document.body.appendChild(btn)
        } catch (e) {
            console.error(`[${PLUGIN_NAME}] fallback mount failed`, e)
        }
    }

    try {
    await mountOpenButton()

    // === 路径常量 ===
    const DEVUI_DIR  = '/data/plugins/u60pro-devui'
    const DATAD_DIR  = '/data/plugins/zwrt-datad'
    const LEGACY_DIR = '/data/u60pro'
    const LEGACY_UI_DIR = '/data/ui'
    const DEVUI_BIN  = `${DEVUI_DIR}/u60pro-devui`
    const DATAD_BIN  = `${DATAD_DIR}/zwrt-datad`
    const DEVUI_START_SH = `${DEVUI_DIR}/start-devui.sh`
    const DATAD_START_SH = `${DATAD_DIR}/start-datad.sh`
    const LEGACY_START_SH = `${DEVUI_DIR}/start.sh`
    const DATAD_LEGACY_START_SH = `${DATAD_DIR}/start.sh`
    const UI_DIR     = `${DEVUI_DIR}/ui`
    // 仅允许填写 DEVUI_DIR 下的相对目录；插件会在加载、启动、状态刷新和安装时自动补齐。
    const REQUIRED_PLUGIN_DIRS = ['ui', 'ui/subpages', 'ui/functions']
    const REQUIRED_PLUGIN_DIR_PATHS = REQUIRED_PLUGIN_DIRS.map((relativePath) => {
        if (typeof relativePath !== 'string' || !relativePath) {
            throw new Error(`非法插件目录: ${relativePath}`)
        }
        const parts = relativePath.split('/')
        if (relativePath.startsWith('/') || relativePath.includes('\\') ||
            !/^[A-Za-z0-9._/-]+$/.test(relativePath) ||
            parts.some(part => !part || part === '.' || part === '..')) {
            throw new Error(`非法插件目录: ${relativePath}`)
        }
        return `${DEVUI_DIR}/${relativePath}`
    })
    const REQUIRED_PLUGIN_DIRS_SH = REQUIRED_PLUGIN_DIR_PATHS.join(' ')
    const SUBPAGES_DIR = `${UI_DIR}/subpages`
    const FUNCTIONS_DIR = `${UI_DIR}/functions`
    const MANAGED_UI_FILES = `${UI_DIR}/.devui-managed-files`
    const REMIX_FUNCTION_FILES = [
        'tailscale.html', 'clash.html', 'cpu-performance.html',
        'wireguard.html', 'operator-lock.html', 'sim-switch.html',
        'sim-traffic.html', 'fmswitch.html', 'fmsimpin.sh', 'timezone.html'
    ]
    const REMIX_FUNCTION_FILES_SH = REMIX_FUNCTION_FILES.join(' ')
    const LOG_DEVUI  = '/tmp/u60pro-devui.log'
    const LOG_DATAD  = '/tmp/zwrt-datad.log'
    const TMP_TGZ    = `${DEVUI_DIR}/ui.tar.gz`
    // 本地 UI 源文件上传暂存目录。
    const UI_UPLOAD_DIR = `${DEVUI_DIR}/ui_upload`
    // 所有上传/下载先进入临时目录；完成校验后才原子替换正式文件。
    // 这样即使浏览器、run_shell 或网络在 90% 以后中断，也不会破坏正在使用的版本。
    const TRANSFER_DIR = `${DEVUI_DIR}/.upload`
    const LOCAL_VERSION_FILE = `${DEVUI_DIR}/version.json`
    const DOWNLOAD_MARKER = `${TRANSFER_DIR}/.keep`
    const DIAGNOSTIC_FILE = '/tmp/u60pro-devui-diagnostic.txt'

    // === 服务名 ===
    const ZTE_SVC  = '/etc/init.d/zte_topsw_devui'
    const ZTE_PROC = 'zte_topsw_devui'
    const DEVUI_PROC = 'u60pro-devui'
    const DATAD_PROC = 'zwrt-datad'
    const LEGACY_DATAD_PROC = 'u60-datad'

    // === 更新源 ==========================================================
    // GitHub 源: <repo>/releases/latest/download/<file>  (优先本机 Mihomo 7890，失败回退直连)
    // 网盘1: AList 直链, 每个文件带独立 ?sign=, 不能用基址拼接 → 用文件全直链表。
    // 网盘2: 独立直链表。
    //   key = `${which}/${file}`  (which: 'datad' | 'devui'; ui 文件归在 devui 下)
    //   表为空 = 网盘未配置。更换网盘/文件后，把对应直链替换即可 (sign 末尾 :0 = 永不过期)。
    const GH_DEVUI = 'https://github.com/33333s/u60pro-devui/releases/latest/download'
    const GH_DATAD = 'https://github.com/33333s/zwrt-datad/releases/latest/download'
    const LOCAL_MIHOMO_PROXY = 'http://127.0.0.1:7890'
    const PRESET_SOURCE_URLS = {
        tasteGithub: 'https://github.com/scoltzero/u60pro-devui-remix/releases/latest/download/{file}',
        tastePan: 'https://pan.ericsfj.com/@s/WdoEaaDt',
    }
    const NETDISK_FILES = {
        'datad/version.json':         'https://pan.ericsfj.com/d/github%20releases/zwrt-datad/version.json?sign=Y9zNv3d2Ofvbx_6Xtdpc8qH5Zt1J2htF_A4yK2zgBC8=:0',
        'datad/zwrt-datad-aarch64':   'https://pan.ericsfj.com/d/github%20releases/zwrt-datad/zwrt-datad-aarch64?sign=ZclbVT-Ki4a-_Fr6FG57o0JE15dxKYdheBOae8yWr_g=:0',
        'devui/u60pro-devui-aarch64': 'https://pan.ericsfj.com/d/github%20releases/u60pro-devui/u60pro-devui-aarch64?sign=9dbniQx7cW6s9ORrAmDw-dW0bUZMO0y1PHgF-sdQEms=:0',
        'devui/ui.tar.gz':            'https://pan.ericsfj.com/d/github%20releases/u60pro-devui/ui.tar.gz?sign=tusrLh33PGnmnwnvjsp-OuHESK-o9iHDdOouN_4kOWU=:0',
        'devui/version.json':         'https://pan.ericsfj.com/d/github%20releases/u60pro-devui/version.json?sign=kuD2GqRAx49yblr9LOQMJz1zefOgkLNqBZnbcCQrLvc=:0',
        'devui/CHANGELOG.md':         'https://pan.ericsfj.com/d/github%20releases/u60pro-devui/CHANGELOG.md?sign=5Wtk9YIuk18ZqiK2y9hrOouaAVP9y9OjC39h_zpvBzA=:0',
    }
    const NETDISK2_FILES = {
        'devui/ui.tar.gz':            'http://pan.39network.cc:5212/f/d/J3WC2/ui.tar.gz',
        'devui/version.json':         'http://pan.39network.cc:5212/f/d/Pgyt5/version.json',
        'devui/u60pro-devui-aarch64': 'http://pan.39network.cc:5212/f/d/KAgiw/u60pro-devui-aarch64',
        'datad/version.json':         'http://pan.39network.cc:5212/f/d/lR3Fp/version.json',
        'datad/zwrt-datad-aarch64':   'http://pan.39network.cc:5212/f/d/nK7Hz/zwrt-datad-aarch64',
    }
    const netdiskReady = () => Object.keys(NETDISK_FILES).length > 0
    const swapUrlOrigin = (u, origin) => {
        const cleanOrigin = String(origin || '').replace(/\/+$/, '')
        try {
            const src = new URL(u)
            const dst = new URL(cleanOrigin)
            src.protocol = dst.protocol
            src.host = dst.host
            return src.toString()
        } catch (e) {
            return String(u).replace(/^https?:\/\/[^/]+/i, cleanOrigin)
        }
    }
    const netdiskUrl = (which, file, srcKey) => {
        const u = NETDISK_FILES[`${which}/${file}`]
        if (!u) throw new Error(`网盘未配置 ${which}/${file}`)
        return srcKey === 'netdisk2' ? (NETDISK2_FILES[`${which}/${file}`] || u) : u
    }

    const SOURCES = {
        github:   { label: '原版 github源' },
        netdisk:  { label: '原版 网盘源1' },
        netdisk2: { label: '原版 网盘源2' },
        tasteGithub: { label: 'scoltzero-remix github源' },
        tastePan:    { label: 'scoltzero-remix 网盘源' },
        custom:   { label: '自定义源链接' },
    }
    const SRC_KEY = 'u60_devui_src'
    const CUSTOM_URL_KEY = 'u60_devui_custom_url'
    const readStoredSrc = () => { try { return localStorage.getItem(SRC_KEY) || '' } catch (e) { return '' } }
    const getSrc = () => readStoredSrc() || 'github'
    const setSrc = (v) => { try { localStorage.setItem(SRC_KEY, v) } catch (e) {} }
    const readCustomUrl = () => { try { return (localStorage.getItem(CUSTOM_URL_KEY) || '').trim() } catch (e) { return '' } }
    const getCustomUrl = () => {
        try {
            const el = document.getElementById('u60_custom_url')
            const v = el && el.value ? String(el.value).trim() : ''
            return v || readCustomUrl()
        } catch (e) { return readCustomUrl() }
    }
    const setCustomUrl = (v) => { try { localStorage.setItem(CUSTOM_URL_KEY, String(v || '').trim()) } catch (e) {} }
    const validateCustomDownloadUrl = (u) => {
        try {
            const parsed = new URL(u)
            if (!/^https?:$/i.test(parsed.protocol)) throw new Error('bad protocol')
            return u
        } catch (e) { throw new Error('自定义链接必须是有效的 http/https 地址') }
    }
    const uniqUrls = (arr) => Array.from(new Set(arr.filter(Boolean).map(String)))
    const appendUrlPath = (base, path) => {
        const safePath = String(path || '').replace(/^\/+/, '')
        try {
            const u = new URL(base)
            const enc = safePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')
            u.pathname = `${u.pathname.replace(/\/+$/, '')}/${enc}`
            return u.toString()
        } catch (e) {
            return `${String(base || '').replace(/\/+$/, '')}/${safePath}`
        }
    }
    // 自定义源链接: 可填目录/分享页/直链。插件会自动按已知文件名尝试:
    //   <链接>/<file>                         (例如 datad 分享目录里的 version.json)
    //   <链接>/<which>/<file>                 (例如统一根目录里的 datad/version.json)
    //   <链接>/<repo>/<file>                  (例如统一根目录里的 zwrt-datad/version.json)
    //   <链接>/github releases/<repo>/<file>  (兼容当前内嵌网盘目录结构)
    // 仍兼容旧模板: {which}=datad/devui, {repo}=zwrt-datad/u60pro-devui, {file}/{asset}=文件名。
    const customFileUrls = (which, file) => {
        const tpl = getCustomUrl()
        if (!tpl) throw new Error('请先填写自定义源链接')
        const repo = which === 'datad' ? 'zwrt-datad' : 'u60pro-devui'
        if (/\{(?:which|repo|file|asset)\}/i.test(tpl)) {
            return [validateCustomDownloadUrl(tpl
                .replace(/\{which\}/gi, which)
                .replace(/\{repo\}/gi, repo)
                .replace(/\{file\}/gi, file)
                .replace(/\{asset\}/gi, file))]
        }
        const base = validateCustomDownloadUrl(tpl.replace(/\/+$/, ''))
        return uniqUrls([
            appendUrlPath(base, file),
            appendUrlPath(base, `${which}/${file}`),
            appendUrlPath(base, `${repo}/${file}`),
            appendUrlPath(base, `github releases/${repo}/${file}`),
        ])
    }
    const usingCustomSrc = () => getSrc() === 'custom'
    const getPresetSourceUrl = () => PRESET_SOURCE_URLS[getSrc()] || ''
    const usingResolvedSrc = () => usingCustomSrc() || !!getPresetSourceUrl()
    const getResolvedSourceUrl = () => getPresetSourceUrl() || getCustomUrl()
    const ensureCustomSourceReady = () => {
        if (usingCustomSrc() && !getCustomUrl()) throw new Error('请先填写自定义源链接。注意: 插件不保证自定义链接文件安全。')
    }
    // 某组件文件的候选下载 URL。which='datad' 的文件在 datad 处, 其余 (devui/ui) 在 devui 处。
    const fileUrls = (which, file) => {
        const src = getSrc()
        if (src === 'custom') return customFileUrls(which, file)
        if (src === 'netdisk' || src === 'netdisk2') return [netdiskUrl(which, file, src)]
        return [`${which === 'datad' ? GH_DATAD : GH_DEVUI}/${file}`]
    }
    const fileUrl = (which, file) => fileUrls(which, file)[0]

    // === 组件定义 ===
    // ui 装在 /data/plugins/u60pro-devui/ui (无独立进程); datad/devui 是二进制 + 进程。
    const COMP = {
        datad: { which: 'datad', label: '后端 zwrt-datad', short: 'datad', icon: '🔌', bin: DATAD_BIN, proc: DATAD_PROC, asset: 'zwrt-datad-aarch64' },
        devui: { which: 'devui', label: '渲染器 devui', short: 'devui', icon: '📺', bin: DEVUI_BIN, proc: DEVUI_PROC, asset: 'u60pro-devui-aarch64' },
        ui:    { which: 'devui', label: 'UI 界面',      short: 'UI',    icon: '🎨', asset: 'ui.tar.gz' },
    }
    const COMP_KEYS = ['datad', 'devui', 'ui']

    // 已装版本 (本地记录, 安装/更新成功后写入)
    const VER_KEY = 'u60_ver_'
    const getVer = (k) => { try { return localStorage.getItem(VER_KEY + k) || '' } catch (e) { return '' } }
    const setVer = (k, v) => { if (!v) return; try { localStorage.setItem(VER_KEY + k, v) } catch (e) {} }
    const clearVers = () => { COMP_KEYS.forEach(k => { try { localStorage.removeItem(VER_KEY + k) } catch (e) {} }) }

    // === 开机自启: /etc/rc.local ===
    const BOOT_KEY = 'u60pro_devui'
    const BOOT_KEY_DEVUI = `${BOOT_KEY}_devui`
    const BOOT_KEY_DATAD = `${BOOT_KEY}_datad`
    const RCLOCAL  = '/etc/rc.local'
    const BOOT_LINE_DATAD = `[ -x ${DATAD_START_SH} ] && sh ${DATAD_START_SH} >/tmp/zwrt-datad-boot.log 2>&1 & # ${BOOT_KEY_DATAD}`
    const BOOT_LINE_DEVUI = `[ -x ${DEVUI_START_SH} ] && sh ${DEVUI_START_SH} >/tmp/u60pro-devui-boot.log 2>&1 & # ${BOOT_KEY_DEVUI}`

    const DEVUI_START_SH_CONTENT = `#!/bin/sh
# Auto-generated by the U60 DevUI management plugin.
DEVUI_DIR=${DEVUI_DIR}
UI_DIR=${UI_DIR}
LEGACY_UI_DIR=${LEGACY_UI_DIR}
DEVUI_BIN=$DEVUI_DIR/u60pro-devui
MODE="\${1:-legacy}"

mkdir -p "$DEVUI_DIR" "$UI_DIR" ${REQUIRED_PLUGIN_DIRS_SH} || exit 1

count_ui_pages() {
    find "$1" -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' '
}

migrate_legacy_ui() {
    [ -d "$LEGACY_UI_DIR" ] || return 0
    [ -f "$LEGACY_UI_DIR/.lockpin" ] && [ ! -f "$UI_DIR/.lockpin" ] \\
        && cp -af "$LEGACY_UI_DIR/.lockpin" "$UI_DIR/.lockpin" 2>/dev/null
    old_count=$(count_ui_pages "$LEGACY_UI_DIR")
    new_count=$(count_ui_pages "$UI_DIR")
    if [ "$new_count" -le 0 ] && [ "$old_count" -gt 0 ]; then
        cp -af "$LEGACY_UI_DIR"/. "$UI_DIR"/ 2>/dev/null || true
    fi
}

read_mode_main_state() {
    awk -F"'" '/option mode_main_state/ { print $2; exit }' /etc/config/zwrt_zte_mc_tmp 2>/dev/null
}

read_reboot_reason_code() {
    awk -F"'" '/option reboot_reason_code/ { print $2; exit }' /etc/config/zwrt_zte_mc_tmp 2>/dev/null
}

boot_trace() {
    LOG="$DEVUI_DIR/boot-trace.log"
    {
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
        echo "mode_main_state=$mode_main_state"
        echo "reboot_reason_code=$reboot_reason_code"
        echo "bootmode=$BOOTMODE"
        echo -n "cmdline="
        cat /proc/cmdline 2>/dev/null
        for f in \\
            /sys/class/power_supply/usb/online \\
            /sys/class/power_supply/usb/voltage_now \\
            /sys/class/power_supply/battery/status \\
            /sys/class/power_supply/battery/capacity \\
            /sys/class/power_supply/charger_zte/present_mbb \\
            /sys/class/power_supply/charger_zte/status_mbb \\
            /sys/class/power_supply/type-c_zte/present_mbb \\
            /sys/class/power_supply/type-c_zte/real_type_mbb \\
            /sys/class/power_supply/statistics_zte/batt_status \\
            /sys/class/power_supply/statistics_zte/batt_online \\
            /sys/class/power_supply/battery_zte/status_mbb \\
            /sys/class/power_supply/battery_zte/online_mbb
        do
            [ -e "$f" ] && echo "$f=$(cat "$f" 2>/dev/null)"
        done
        for e in /dev/input/event*; do
            [ -e "$e" ] || continue
            echo "$e=$(cat /sys/class/input/\${e##*/}/device/name 2>/dev/null)"
        done
        echo
    } >> "$LOG"
    tail -n 160 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
}

stop_vendor_ui() {
    had_vendor=0
    pidof zte_topsw_devui >/dev/null 2>&1 && had_vendor=1
    /etc/init.d/zte_topsw_devui stop 2>/dev/null
    killall -9 zte_topsw_devui 2>/dev/null
    [ "$had_vendor" -eq 1 ] && sleep 1
}

BOOTMODE=charge
mode_main_state="$(read_mode_main_state)"
reboot_reason_code="$(read_reboot_reason_code)"
case "$mode_main_state" in
    mode_power_off_*) BOOTMODE=charge ;;
    mode_power_on|mode_power_on_charger) BOOTMODE=normal ;;
    *)
        if grep -q 'silent_boot.mode=nonsilent' /proc/cmdline 2>/dev/null; then
            BOOTMODE=normal
        fi
        ;;
esac
boot_trace
migrate_legacy_ui
pidof u60pro-devui >/dev/null 2>&1 && exit 0

case "$MODE" in
    procd)
        stop_vendor_ui
        [ -x "$DEVUI_BIN" ] || exit 1
        exec "$DEVUI_BIN"
        ;;
    legacy)
        stop_vendor_ui
        [ -x "$DEVUI_BIN" ] && nohup "$DEVUI_BIN" >/dev/null 2>&1 </dev/null &
        ;;
    *)
        echo "usage: $0 [procd|legacy]" >&2
        exit 2
        ;;
esac
`

    const DATAD_START_SH_CONTENT = `#!/bin/sh
# Auto-generated by the U60 DevUI management plugin.
DATAD_DIR=${DATAD_DIR}
DATAD_BIN=$DATAD_DIR/zwrt-datad
DATAD_TOKEN_FILE=$DATAD_DIR/auth.token
U60_FORCE_DATAD=\${U60_FORCE_DATAD:-0}

mkdir -p "$DATAD_DIR"

read_mode_main_state() {
    awk -F"'" '/option mode_main_state/ { print $2; exit }' /etc/config/zwrt_zte_mc_tmp 2>/dev/null
}

read_reboot_reason_code() {
    awk -F"'" '/option reboot_reason_code/ { print $2; exit }' /etc/config/zwrt_zte_mc_tmp 2>/dev/null
}

boot_trace() {
    LOG="$DATAD_DIR/boot-trace.log"
    {
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
        echo "mode_main_state=$mode_main_state"
        echo "reboot_reason_code=$reboot_reason_code"
        echo "bootmode=$BOOTMODE"
        echo -n "cmdline="
        cat /proc/cmdline 2>/dev/null
        echo
    } >> "$LOG"
    tail -n 160 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
}

BOOTMODE=charge
mode_main_state="$(read_mode_main_state)"
reboot_reason_code="$(read_reboot_reason_code)"
case "$mode_main_state" in
    mode_power_off_*) BOOTMODE=charge ;;
    mode_power_on|mode_power_on_charger) BOOTMODE=normal ;;
    *)
        if grep -q 'silent_boot.mode=nonsilent' /proc/cmdline 2>/dev/null; then
            BOOTMODE=normal
        fi
        ;;
esac
boot_trace

[ "$BOOTMODE" = normal ] || [ "$U60_FORCE_DATAD" = 1 ] || exit 0
[ -x "$DATAD_BIN" ] || exit 0
pidof zwrt-datad >/dev/null 2>&1 && exit 0
killall -9 u60-datad 2>/dev/null
# datad 的 DCI 后端可能输出逐包调试信息；/tmp 位于内存中，不能无上限落盘。
nohup "$DATAD_BIN" -i 1000 --auth-token-file "$DATAD_TOKEN_FILE" >/dev/null 2>&1 </dev/null &
sleep 1
`

    // === runShellWithRoot shim ===
    if (typeof window.runShellWithRoot !== 'function') {
        window.runShellWithRoot = async (cmd, timeoutMs = 30000) => {
            try {
                const base = (typeof KANO_baseURL !== 'undefined' && KANO_baseURL) ? KANO_baseURL : '/api'
                const headers = { 'Content-Type': 'application/json' }
                if (typeof common_headers !== 'undefined' && common_headers) {
                    Object.assign(headers, common_headers)
                    headers['Content-Type'] = 'application/json'
                }
                const res = await fetch(`${base}/run_shell`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ cmd: String(cmd), timeout: Number(timeoutMs) || 30000 })
                })
                if (!res.ok) return { success: false, content: `HTTP ${res.status}` }
                const data = await res.json()
                return { success: !!data.success, content: data.content || '' }
            } catch (e) { return { success: false, content: String(e && e.message || e) } }
        }
    }
    const sh = (cmd, t) => runShellWithRoot(cmd, t)
    let pluginDirsReady = false
    let pluginDirsPromise = null
    const ensurePluginDirs = async ({ force = false } = {}) => {
        if (pluginDirsReady && !force) return
        if (pluginDirsPromise) return pluginDirsPromise
        pluginDirsPromise = (async () => {
            const r = await sh(`mkdir -p ${REQUIRED_PLUGIN_DIRS_SH} 2>&1`, 5000)
            if (!r.success) throw new Error(`创建插件必备目录失败: ${r.content || '(空)'}`)
            pluginDirsReady = true
        })()
        try { await pluginDirsPromise }
        finally { pluginDirsPromise = null }
    }
    const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
    const isGithubUrl = (value) => {
        try {
            const host = new URL(String(value || '')).hostname.toLowerCase()
            return host === 'github.com' || host.endsWith('.github.com') ||
                host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')
        } catch (e) { return false }
    }
    const addGithubCacheBust = (value) => {
        if (!isGithubUrl(value)) return String(value || '')
        try {
            const u = new URL(String(value))
            u.searchParams.set('_u60ts', String(Date.now()))
            return u.toString()
        } catch (e) { return String(value || '') }
    }
    let githubProxyProbeAt = 0
    let githubProxyAvailable = false
    const hasWorkingMihomoGithubProxy = async ({ force = false } = {}) => {
        const now = Date.now()
        if (!force && now - githubProxyProbeAt < 30000) return githubProxyAvailable
        githubProxyProbeAt = now
        const r = await sh(`
if pidof mihomo >/dev/null 2>&1 && (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null) | grep -q ':7890[[:space:]]'; then
    code=$(curl -x ${LOCAL_MIHOMO_PROXY} -L -k -sS --connect-timeout 5 --max-time 12 -o /dev/null -w '%{http_code}' https://github.com/ 2>/dev/null || true)
    case "$code" in 2*|3*) echo yes ;; esac
fi
`, 18000)
        githubProxyAvailable = !!(r.success && /(^|\n)yes(\n|$)/.test((r.content || '').trim()))
        LOG(`GitHub download route: ${githubProxyAvailable ? 'Mihomo 127.0.0.1:7890 first' : 'direct'}`)
        return githubProxyAvailable
    }
    const networkRoutesForUrl = async (url) => {
        const routes = []
        if (isGithubUrl(url) && await hasWorkingMihomoGithubProxy()) {
            routes.push({ label: 'Mihomo代理', curlArgs: `-x ${LOCAL_MIHOMO_PROXY}` })
        }
        routes.push({ label: '直连', curlArgs: '' })
        return routes
    }
    const waitForHostReady = async () => {
        await waitForBody()
        for (let i = 0; i < 100; i++) {
            if (typeof UFI_DATA !== 'undefined') return
            await wait(100)
        }
        LOG('UFI_DATA 未就绪，继续以兼容模式加载')
    }
    await waitForHostReady()
    void ensurePluginDirs().catch(e => LOG('initial required directory check failed', e))

    const isRoot = async () => {
        const r = await sh('id -u', 3000)
        return ((r && r.content) || '').trim() === '0'
    }

    // === 设备状态查询 ===
    const queryStatus = async ({ ensureDirs = false } = {}) => {
        if (ensureDirs) await ensurePluginDirs()
        const r = await sh(`
echo "INSTALLED_DEVUI=$([ -x ${DEVUI_BIN} ] && echo yes || echo no)"
echo "INSTALLED_DATAD=$([ -x ${DATAD_BIN} ] && echo yes || echo no)"
echo "SIZE_DEVUI=$([ -f ${DEVUI_BIN} ] && wc -c < ${DEVUI_BIN} || echo 0)"
echo "SIZE_DATAD=$([ -f ${DATAD_BIN} ] && wc -c < ${DATAD_BIN} || echo 0)"
echo "UI_FILES=$(ls ${UI_DIR}/*.html 2>/dev/null | wc -l)"
echo "SUBPAGE_FILES=$(find ${UI_DIR} -type f \\( -path '*/subpages/*.html' -o -path '*/subpage/*.html' -o -path '*/pages/*.html' \\) 2>/dev/null | wc -l | tr -d ' ')"
echo "FUNCTION_FILES=$(find ${FUNCTIONS_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')"
MANAGED_EXPECTED=0
MANAGED_PRESENT=0
MANAGED_FUNCTION_EXPECTED=0
MANAGED_FUNCTION_PRESENT=0
MISSING_MANAGED_FILES=
if [ -f ${MANAGED_UI_FILES} ]; then
    while IFS= read -r rel || [ -n "$rel" ]; do
        case "$rel" in ''|'#'*) continue ;; esac
        MANAGED_EXPECTED=$((MANAGED_EXPECTED + 1))
        case "$rel" in functions/*.html) MANAGED_FUNCTION_EXPECTED=$((MANAGED_FUNCTION_EXPECTED + 1)) ;; esac
        if [ -f "${UI_DIR}/$rel" ]; then
            MANAGED_PRESENT=$((MANAGED_PRESENT + 1))
            case "$rel" in functions/*.html) MANAGED_FUNCTION_PRESENT=$((MANAGED_FUNCTION_PRESENT + 1)) ;; esac
        else
            [ -z "$MISSING_MANAGED_FILES" ] && MISSING_MANAGED_FILES="$rel" || MISSING_MANAGED_FILES="$MISSING_MANAGED_FILES,$rel"
        fi
    done < ${MANAGED_UI_FILES}
fi
REMIX_FUNCTION_PRESENT=0
REMIX_MISSING_FUNCTION_FILES=
for f in ${REMIX_FUNCTION_FILES_SH}; do
    if [ -f "${FUNCTIONS_DIR}/$f" ]; then
        REMIX_FUNCTION_PRESENT=$((REMIX_FUNCTION_PRESENT + 1))
    else
        [ -z "$REMIX_MISSING_FUNCTION_FILES" ] && REMIX_MISSING_FUNCTION_FILES="$f" || REMIX_MISSING_FUNCTION_FILES="$REMIX_MISSING_FUNCTION_FILES,$f"
    fi
done
echo "MANAGED_FILES_EXPECTED=$MANAGED_EXPECTED"
echo "MANAGED_FILES_PRESENT=$MANAGED_PRESENT"
echo "MANAGED_FUNCTION_EXPECTED=$MANAGED_FUNCTION_EXPECTED"
echo "MANAGED_FUNCTION_PRESENT=$MANAGED_FUNCTION_PRESENT"
echo "MISSING_MANAGED_FILES=$MISSING_MANAGED_FILES"
echo "REMIX_FUNCTION_EXPECTED=${REMIX_FUNCTION_FILES.length}"
echo "REMIX_FUNCTION_PRESENT=$REMIX_FUNCTION_PRESENT"
echo "REMIX_MISSING_FUNCTION_FILES=$REMIX_MISSING_FUNCTION_FILES"
echo "RUNNING_DEVUI=$(pidof ${DEVUI_PROC} 2>/dev/null | wc -w)"
echo "RUNNING_DATAD=$(pidof ${DATAD_PROC} 2>/dev/null | wc -w)"
echo "PERSIST=$([ -f ${RCLOCAL} ] && grep -qF '${BOOT_KEY_DATAD}' ${RCLOCAL} 2>/dev/null && grep -qF '${BOOT_KEY_DEVUI}' ${RCLOCAL} 2>/dev/null && echo yes || echo no)"
LEGACY_ITEMS=
add_legacy() {
    if [ -z "$LEGACY_ITEMS" ]; then
        LEGACY_ITEMS="$1"
    else
        LEGACY_ITEMS="$LEGACY_ITEMS; $1"
    fi
}
[ -f ${DATAD_DIR}/u60-datad ] && add_legacy '${DATAD_DIR}/u60-datad'
[ -f ${LEGACY_DIR}/u60pro-devui ] && add_legacy '${LEGACY_DIR}/u60pro-devui'
[ -f ${LEGACY_DIR}/u60-datad ] && add_legacy '${LEGACY_DIR}/u60-datad'
[ -f ${LEGACY_DIR}/zwrt-datad ] && add_legacy '${LEGACY_DIR}/zwrt-datad'
[ -f ${LEGACY_DIR}/start.sh ] && add_legacy '${LEGACY_DIR}/start.sh'
[ -f ${LEGACY_START_SH} ] && add_legacy '${LEGACY_START_SH}'
[ -f ${DATAD_LEGACY_START_SH} ] && add_legacy '${DATAD_LEGACY_START_SH}'
[ -f ${LEGACY_DIR}/u60pro_ui.tar.gz ] && add_legacy '${LEGACY_DIR}/u60pro_ui.tar.gz'
[ -f ${LEGACY_DIR}/ui.tar.gz ] && add_legacy '${LEGACY_DIR}/ui.tar.gz'
[ -f ${LEGACY_DIR}/boot-trace.log ] && add_legacy '${LEGACY_DIR}/boot-trace.log'
[ -d ${LEGACY_DIR}/ui_extract ] && add_legacy '${LEGACY_DIR}/ui_extract/'
[ -d ${LEGACY_UI_DIR} ] && add_legacy '${LEGACY_UI_DIR}/'
[ -f /etc/init.d/u60-datad ] && add_legacy '/etc/init.d/u60-datad'
[ -f /etc/init.d/zwrt-datad ] && add_legacy '/etc/init.d/zwrt-datad'
[ -f /etc/init.d/u60pro-devui ] && add_legacy '/etc/init.d/u60pro-devui'
ls /etc/rc.d/S*u60-datad /etc/rc.d/K*u60-datad >/dev/null 2>&1 && add_legacy 'u60-datad rc.d 软链接'
ls /etc/rc.d/S*zwrt-datad /etc/rc.d/K*zwrt-datad >/dev/null 2>&1 && add_legacy 'zwrt-datad rc.d 软链接'
ls /etc/rc.d/S*u60pro-devui /etc/rc.d/K*u60pro-devui >/dev/null 2>&1 && add_legacy 'u60pro-devui rc.d 软链接'
grep -qF '${LEGACY_DIR}/start.sh' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 start.sh 钩子'
grep -qF '${LEGACY_START_SH}' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧插件 start.sh 钩子'
grep -qF '${DATAD_LEGACY_START_SH}' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 datad start.sh 钩子'
grep -qF '${DEVUI_BIN}' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 devui 二进制钩子'
grep -qF '${DATAD_BIN}' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 datad 二进制钩子'
grep -qF '/etc/init.d/u60pro-devui' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 u60pro-devui init.d 钩子'
grep -qF '/etc/init.d/zwrt-datad' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 zwrt-datad init.d 钩子'
grep -qF '/etc/init.d/u60-datad' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧 u60-datad init.d 钩子'
grep -Eq '#[[:space:]]*${BOOT_KEY}[[:space:]]*$' ${RCLOCAL} 2>/dev/null && add_legacy 'rc.local 旧单脚本自启钩子'
echo "LEGACY_RESIDUE=$([ -n "$LEGACY_ITEMS" ] && echo yes || echo no)"
echo "LEGACY_ITEMS=$LEGACY_ITEMS"
`, 6000)
        const map = {}
        ;(r.content || '').split('\n').forEach(line => {
            const i = line.indexOf('=')
            if (i > 0) map[line.slice(0, i)] = line.slice(i + 1).trim()
        })
        return map
    }

    const checkEnv = async () => {
        const r = await sh(`
echo "UID=$(id -u)"
echo "CURL=$(command -v curl >/dev/null 2>&1 && echo yes || echo no)"
echo "TAR=$(command -v tar >/dev/null 2>&1 && echo yes || echo no)"
echo "ARCH=$(uname -m)"
echo "DRM=$([ -e /dev/dri/card0 ] && echo yes || echo no)"
`, 5000)
        const map = {}
        ;(r.content || '').split('\n').forEach(line => {
            const i = line.indexOf('=')
            if (i > 0) map[line.slice(0, i)] = line.slice(i + 1).trim()
        })
        return map
    }

    // === 自定义源链接解析 ===
    // 可填目录/分享页/直链: 插件会先读目录页/API, 自动找 version.json、二进制或 ui.tar.gz。
    // 仍兼容高级模板: https://example.com/{which}/{file} / {repo} / {asset}。
    let customResolveCache = {}
    const resetCustomResolveCache = () => { customResolveCache = {} }
    const CUSTOM_SOURCE_FILE_NAMES = ['version.json', 'zwrt-datad-aarch64', 'u60pro-devui-aarch64', 'ui.tar.gz']
    const safeDecode = (s) => {
        try { return decodeURIComponent(String(s || '')) } catch (e) { return String(s || '') }
    }
    const dehtml = (s) => String(s || '')
        .replace(/\\u002f/ig, '/')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/ig, '&')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
    const uniq = (arr) => {
        const seen = new Set(), out = []
        ;(arr || []).forEach(x => {
            const v = String(x || '').trim()
            if (!v || seen.has(v)) return
            seen.add(v); out.push(v)
        })
        return out
    }
    const customRepoOf = (which) => which === 'datad' ? 'zwrt-datad' : 'u60pro-devui'
    const customShareRootFromPath = (path) => {
        const segs = String(path || '').split('/').filter(Boolean)
        if (segs.length >= 2 && (segs[0] === '@s' || segs[0] === '%40s')) return `/@s/${segs[1]}`
        if (segs.length >= 2 && segs[0] === 'sd') return `/@s/${segs[1]}`
        return ''
    }
    const customBaseInfo = (base) => {
        try {
            const cleanUrl = validateCustomDownloadUrl(base)
            const u = new URL(cleanUrl)
            const rawPath = safeDecode(u.pathname || '/')
            const segs = rawPath.split('/').filter(Boolean)
            const file = segs.length ? segs[segs.length - 1] : ''
            const fileLower = file.toLowerCase()
            const isKnownFile = CUSTOM_SOURCE_FILE_NAMES.includes(fileLower)
            const dirSegs = isKnownFile ? segs.slice(0, -1) : segs
            const dirPath = `/${dirSegs.join('/')}` || '/'
            const dirUrl = new URL(cleanUrl)
            dirUrl.pathname = dirPath || '/'
            dirUrl.search = ''
            dirUrl.hash = ''
            return {
                cleanUrl,
                rawPath,
                file,
                fileLower,
                isKnownFile,
                dirPath,
                dirUrl: dirUrl.toString(),
                shareRootPath: customShareRootFromPath(rawPath),
            }
        } catch (e) { return null }
    }
    const customAbsUrl = (href, base) => {
        try {
            let h = dehtml(href).trim()
            if (!h || /^(javascript|mailto):/i.test(h)) return ''
            return validateCustomDownloadUrl(new URL(h, base).toString())
        } catch (e) { return '' }
    }
    const customJoin = (base, part) => `${String(base || '').replace(/\/+$/, '')}/${String(part || '').replace(/^\/+/, '')}`
    const customPathJoin = (p, name) => `${String(p || '').replace(/\/+$/, '')}/${String(name || '').replace(/^\/+/, '')}`
    const customPathToUrl = (p) => String(p || '').split('/').map((seg, i) => i === 0 ? '' : encodeURIComponent(seg)).join('/')
    const customBuildShareDownUrl = (origin, shareRootPath, filePath) => {
        const m = String(shareRootPath || '').match(/^\/@s\/([^/]+)/)
        if (!m) return ''
        let rel = String(filePath || '')
        if (rel.startsWith(shareRootPath)) rel = rel.slice(shareRootPath.length)
        rel = '/' + rel.replace(/^\/+/, '')
        return `${String(origin || '').replace(/\/+$/, '')}/sd/${encodeURIComponent(m[1])}${customPathToUrl(rel)}`
    }
    const customCurlText = async (url, limit = 240000) => {
        const routes = await networkRoutesForUrl(url)
        for (const route of routes) {
            const r = await sh(
                `curl ${route.curlArgs} -L -k -sS --connect-timeout 8 --max-time 20 ${shellQuote(url)} | head -c ${Number(limit) || 240000}`,
                30000)
            if (r.success && r.content) return r.content
            LOG('custom source probe failed', route.label, url, r.content || '')
        }
        return ''
    }
    const customCurlJsonPost = async (url, body) => {
        const r = await sh(
            `curl -L -k -s --max-time 20 -H 'Content-Type: application/json' --data-binary ${shellQuote(JSON.stringify(body || {}))} ${shellQuote(url)}`,
            30000)
        if (!r.success || !r.content) return null
        try { return JSON.parse(r.content) } catch (e) { return null }
    }
    const customExtractLinks = (text, baseUrl) => {
        const out = []
        const t = dehtml(text)
        const push = (v) => {
            const u = customAbsUrl(v, baseUrl)
            if (u) out.push(u)
        }
        let m
        const attrRe = /\b(?:href|src|action)\s*=\s*["']([^"']+)["']/ig
        while ((m = attrRe.exec(t))) push(m[1])
        const jsonRe = /"(?:url|raw_url|rawUrl|download_url|downloadUrl|href|src|path)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/ig
        while ((m = jsonRe.exec(t))) push(m[1])
        const absRe = /https?:\/\/[^\s"'<>\\]+/ig
        while ((m = absRe.exec(t))) push(m[0])
        return uniq(out)
    }
    const customExtractFileUrls = (text, baseUrl, file) => {
        const f = String(file || '').toLowerCase()
        const ef = encodeURIComponent(file).toLowerCase()
        return customExtractLinks(text, baseUrl).filter(u => {
            const hay = safeDecode(u).toLowerCase()
            return hay.includes(f) || hay.includes(ef)
        })
    }
    const customJsonDeepUrls = (obj, baseUrl, file) => {
        const out = []
        const f = String(file || '').toLowerCase()
        const walk = (v) => {
            if (!v) return
            if (Array.isArray(v)) { v.forEach(walk); return }
            if (typeof v !== 'object') return
            const name = String(v.name || v.filename || v.file_name || '').toLowerCase()
            if (name === f || name.endsWith('/' + f)) {
                ;['raw_url', 'rawUrl', 'download_url', 'downloadUrl', 'url', 'href', 'path'].forEach(k => {
                    if (v[k]) {
                        const u = customAbsUrl(v[k], baseUrl)
                        if (u) out.push(u)
                    }
                })
            }
            Object.keys(v).forEach(k => walk(v[k]))
        }
        walk(obj)
        return uniq(out)
    }
    const customFallbackCandidates = (base, which, file) => {
        const repo = customRepoOf(which)
        const b = String(base || '').replace(/\/+$/, '')
        const info = customBaseInfo(b)
        const enc = encodeURIComponent(file)
        const arr = []
        const bases = uniq([info && info.isKnownFile ? info.dirUrl : '', b].filter(Boolean))
        bases.forEach(baseUrl => {
            const bb = String(baseUrl || '').replace(/\/+$/, '')
            if (!bb) return
            if (safeDecode(bb).toLowerCase().endsWith('/' + String(file).toLowerCase())) arr.push(bb)
            arr.push(customJoin(bb, file), customJoin(bb, enc))
            arr.push(customJoin(customJoin(bb, which), file), customJoin(customJoin(bb, which), enc))
            arr.push(customJoin(customJoin(bb, repo), file), customJoin(customJoin(bb, repo), enc))
            arr.push(customJoin(customJoin(customJoin(bb, 'github releases'), repo), file))
            arr.push(customJoin(customJoin(customJoin(bb, 'github releases'), repo), enc))
        })
        if (info && info.shareRootPath) {
            try {
                const u = new URL(info.cleanUrl)
                const origin = `${u.protocol}//${u.host}`
                const shareCandidates = [
                    customBuildShareDownUrl(origin, info.shareRootPath, customPathJoin(info.shareRootPath, file)),
                    customBuildShareDownUrl(origin, info.shareRootPath, customPathJoin(customPathJoin(info.shareRootPath, which), file)),
                    customBuildShareDownUrl(origin, info.shareRootPath, customPathJoin(customPathJoin(info.shareRootPath, repo), file)),
                ]
                arr.push(...shareCandidates.filter(Boolean))
            } catch (e) {}
        }
        return uniq(arr.map(v => {
            try { return validateCustomDownloadUrl(v) } catch (e) { return '' }
        }).filter(Boolean))
    }
    const customAListCandidates = async (base, which, file) => {
        const out = []
        let u
        try { u = new URL(base) } catch (e) { return out }
        const origin = `${u.protocol}//${u.host}`
        const repo = customRepoOf(which)
        const info = customBaseInfo(base)
        const basePath = (info && info.shareRootPath) || (info && info.isKnownFile && info.dirPath) || safeDecode(u.pathname || '/') || '/'
        const paths = uniq([
            basePath,
            customPathJoin(basePath, which),
            customPathJoin(basePath, repo),
        ])
        for (const p of paths) {
            const list = await customCurlJsonPost(`${origin}/api/fs/list`, { path: p, password: '', page: 1, per_page: 200, refresh: false })
            const content = list && list.data && Array.isArray(list.data.content) ? list.data.content : []
            const item = content.find(x => String(x && x.name || '').toLowerCase() === String(file).toLowerCase())
            if (item) {
                ;['raw_url', 'rawUrl', 'download_url', 'downloadUrl', 'url', 'href', 'path'].forEach(k => {
                    if (item[k]) {
                        const abs = customAbsUrl(item[k], base)
                        if (abs) out.push(abs)
                    }
                })
                const fp = customPathJoin(p, file)
                if (info && info.shareRootPath) {
                    const shareUrl = customBuildShareDownUrl(origin, info.shareRootPath, fp)
                    if (shareUrl) out.push(shareUrl)
                }
                if (item.sign) out.push(`${origin}/d${customPathToUrl(fp)}?sign=${encodeURIComponent(item.sign)}`)
                out.push(`${origin}/d${customPathToUrl(fp)}`)
            }
            const fp = customPathJoin(p, file)
            const got = await customCurlJsonPost(`${origin}/api/fs/get`, { path: fp, password: '' })
            const data = got && got.data ? got.data : null
            if (data) {
                ;['raw_url', 'rawUrl', 'download_url', 'downloadUrl', 'url', 'href', 'path'].forEach(k => {
                    if (data[k]) {
                        const abs = customAbsUrl(data[k], base)
                        if (abs) out.push(abs)
                    }
                })
                if (info && info.shareRootPath) {
                    const shareUrl = customBuildShareDownUrl(origin, info.shareRootPath, fp)
                    if (shareUrl) out.push(shareUrl)
                }
                if (data.sign) out.push(`${origin}/d${customPathToUrl(fp)}?sign=${encodeURIComponent(data.sign)}`)
                out.push(`${origin}/d${customPathToUrl(fp)}`)
            }
        }
        return uniq(out)
    }
    const resolveCustomFileUrl = async (which, file) => {
        const base = getResolvedSourceUrl()
        if (!base) throw new Error('请先填写自定义源链接')
        const repo = customRepoOf(which)
        const key = `${base}|${which}|${file}`
        if (customResolveCache[key]) return customResolveCache[key]
        if (/\{(?:which|repo|file|asset)\}/i.test(base)) {
            const u = validateCustomDownloadUrl(base
                .replace(/\{which\}/gi, which)
                .replace(/\{repo\}/gi, repo)
                .replace(/\{file\}/gi, file)
                .replace(/\{asset\}/gi, file))
            customResolveCache[key] = u
            return u
        }
        const cleanBase = validateCustomDownloadUrl(base)
        const baseInfo = customBaseInfo(cleanBase)
        if (baseInfo && baseInfo.isKnownFile && baseInfo.fileLower === String(file || '').toLowerCase()) {
            customResolveCache[key] = cleanBase
            return cleanBase
        }
        const probeBase = baseInfo && baseInfo.isKnownFile ? baseInfo.dirUrl : cleanBase
        const pageUrls = uniq([
            probeBase,
            cleanBase,
            customJoin(probeBase, which),
            customJoin(probeBase, repo),
            customJoin(probeBase, 'github releases'),
            customJoin(customJoin(probeBase, 'github releases'), repo),
        ])
        const found = []
        for (const page of pageUrls) {
            try {
                const text = await customCurlText(page)
                found.push(...customExtractFileUrls(text, page, file))
                try { found.push(...customJsonDeepUrls(JSON.parse(text), page, file)) } catch (e) {}
                // 如果根目录页里出现了 datad / devui / repo 子目录链接, 再向下一层找一次。
                const links = customExtractLinks(text, page).filter(u => {
                    const hay = safeDecode(u).toLowerCase()
                    return hay.includes('/' + which.toLowerCase()) || hay.includes('/' + repo.toLowerCase()) || hay.includes('github releases') || hay.includes('github%20releases')
                }).slice(0, 8)
                for (const child of links) {
                    const ct = await customCurlText(child)
                    found.push(...customExtractFileUrls(ct, child, file))
                    try { found.push(...customJsonDeepUrls(JSON.parse(ct), child, file)) } catch (e) {}
                }
            } catch (e) { LOG('custom page probe failed', page, e) }
        }
        try { found.push(...await customAListCandidates(cleanBase, which, file)) } catch (e) { LOG('custom alist probe failed', e) }
        const all = uniq([...found, ...customFallbackCandidates(probeBase, which, file), ...customFallbackCandidates(cleanBase, which, file)])
        if (file === 'version.json') {
            for (const u of all) {
                const j = await fetchJson(u)
                if (j) { customResolveCache[key] = u; return u }
            }
        }
        if (all.length) { customResolveCache[key] = all; return all }
        throw new Error(`自定义链接下没有找到 ${which}/${file}`)
    }
    const resolveFileUrl = async (which, file) => {
        if (!usingResolvedSrc()) return fileUrl(which, file)
        return resolveCustomFileUrl(which, file)
    }

    // === version.json 拉取 ===
    const fetchJson = async (urls) => {
        const list = Array.isArray(urls) ? urls : [urls]
        for (const url of list) {
            const target = addGithubCacheBust(url)
            const routes = await networkRoutesForUrl(target)
            for (const route of routes) {
                const r = await sh(
                    `curl ${route.curlArgs} -L -k -sS --connect-timeout 8 --max-time 15 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' ${shellQuote(target)}`,
                    22000)
                if (!r.success || !r.content) {
                    LOG('version fetch failed', route.label, target, r.content || '')
                    continue
                }
                try {
                    LOG('version fetch succeeded', route.label, target)
                    return JSON.parse(r.content)
                } catch (e) { LOG('bad json, try next route', route.label, target, e) }
            }
        }
        return null
    }
    // → { datad:{version,asset}|null, devui:{...}|null, ui:{...}|null }
    const fetchRemoteVersions = async () => {
        const out = { datad: null, devui: null, ui: null }
        if (usingCustomSrc() && !getCustomUrl()) return out
        try {
            const dvUrl = await resolveFileUrl('devui', 'version.json')
            const dv = await fetchJson(dvUrl)
            if (dv) { out.devui = dv.devui || null; out.ui = dv.ui || null }
        } catch (e) { LOG('devui version.json', e) }
        try {
            const dtUrl = await resolveFileUrl('datad', 'version.json')
            const dt = await fetchJson(dtUrl)
            if (dt) out.datad = dt.datad || null
        } catch (e) { LOG('datad version.json', e) }
        return out
    }

    // === 进度 toast (复用单一固定 toast, 多步下载不叠) ===
    const PROGRESS_TOAST_ID = 'u60_devui_progress_toast'
    let progressEl = null, progressClose = null
    const openProgress = (title) => {
        try {
            const { el, close } = createFixedToast(PROGRESS_TOAST_ID,
                `<pre style="white-space:pre-wrap;min-width:280px;text-align:center;font-size:11px;">${escapeHtml(title)}</pre>`)
            progressEl = el; progressClose = close
            el.style.maxHeight = '70vh'; el.style.maxWidth = '92vw'; el.style.overflow = 'hidden'
        } catch (e) {}
    }
    const updateProgress = (title, body) => {
        if (!progressEl) return
        const normalized = String(body || '').replace(/\r/g, '\n')
        const lines = normalized.split('\n')
        const visible = lines.length > 80 ? lines.slice(-80).join('\n') : normalized
        const safe = escapeHtml(visible).trim() || '(等待 curl 输出 ...)'
        progressEl.innerHTML =
            `<div style="font-weight:600;font-size:12px;margin-bottom:6px;">${escapeHtml(title)}</div>` +
            `<pre data-u60-progress-log="1" style="white-space:pre-wrap;overflow-wrap:anywhere;min-width:280px;max-width:min(82vw,760px);font-size:10px;line-height:1.4;text-align:left;margin:0;background:rgba(0,0,0,.25);padding:8px;border-radius:4px;height:min(42vh,340px);overflow-y:auto;overscroll-behavior:contain;">${safe}</pre>`
        try {
            const terminal = progressEl.querySelector('[data-u60-progress-log="1"]')
            if (terminal) terminal.scrollTop = terminal.scrollHeight
            progressEl.scrollTop = progressEl.scrollHeight
        } catch (e) {}
    }
    const closeProgress = () => {
        try { progressClose && progressClose() } catch (e) {}
        progressEl = null; progressClose = null
    }

    // === 后台下载 + 轮询展示 curl 日志 ===
    const transferNonce = () => `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`
    const downloadOneWithProgress = async (attempt, dest, dlog, label, idx, total) => {
        const { url, route } = attempt
        const prefix = total > 1 ? `${label} [${idx}/${total} ${route.label}]` : `${label} [${route.label}]`
        await ensurePluginDirs({ force: true })
        const temp = `${TRANSFER_DIR}/.downloading.${transferNonce()}`
        const pidFile = `${temp}.pid`
        const logFile = `${temp}.log`
        let committed = false
        try {
            const prep = await sh(`mkdir -p ${shellQuote(TRANSFER_DIR)} "$(dirname ${shellQuote(dest)})" ${shellQuote(DATAD_DIR)} && rm -f ${shellQuote(temp)} ${shellQuote(pidFile)} ${shellQuote(logFile)}`, 8000)
            if (!prep.success) throw new Error(`${prefix} 下载目录准备失败: ${prep.content || '(空)'}`)
            const curlCmd =
                `curl ${route.curlArgs} -fL -k --connect-timeout 20 --max-time 600 --retry 3 --retry-delay 3 ` +
                `${shellQuote(url)} -o ${shellQuote(temp)} ` +
                `--write-out "\\nTotal: %{size_download} bytes\\nSpeed: %{speed_download} B/s\\nHTTP: %{http_code}\\nTime: %{time_total}s\\n"`
            const backgroundCmd = `${curlCmd} & cp=$!; printf '%s\\n' "$cp" > ${shellQuote(pidFile)}; wait "$cp"; rc=$?; printf '\\nCURL_EXIT: %s\\nDOWNLOAD_DONE\\n' "$rc"`
            const start = await sh(`nohup sh -c ${shellQuote(backgroundCmd)} >${shellQuote(logFile)} 2>&1 </dev/null & echo started`, 10000)
            if (!start.success || !/started/.test(start.content || '')) throw new Error(`${prefix} 后台下载启动失败: ${start.content || '(空)'}`)
            if (!progressEl) openProgress(`下载 ${label} ...`)
            updateProgress(`下载 ${prefix} ...`, `连接方式: ${route.label}\n临时缓存: ${temp}\n\n(连接中)`)
            const TIMEOUT = 10 * 60 * 1000
            const t0 = performance.now()
            while (true) {
                await wait(1000)
                const r = await sh(`tail -c 16000 ${shellQuote(logFile)} 2>/dev/null`, 3000)
                const text = r.content || ''
                updateProgress(`下载 ${prefix} ...`, `连接方式: ${route.label}\n\n${text}`)
                if (text.includes('DOWNLOAD_DONE')) {
                    const exitMatch = text.match(/CURL_EXIT:\s*(\d+)/)
                    const httpMatch = text.match(/HTTP:\s*(\d+)/)
                    const curlExit = exitMatch ? Number(exitMatch[1]) : -1
                    const httpCode = httpMatch ? httpMatch[1] : '000'
                    if (curlExit !== 0) throw new Error(`${prefix} curl exit=${curlExit}, HTTP=${httpCode}`)
                    if (!/^2\d\d$/.test(httpCode)) throw new Error(`${prefix} HTTP=${httpCode}`)
                    const sz = await sh(`wc -c < ${shellQuote(temp)} 2>/dev/null || echo 0`, 3000)
                    const got = parseInt((sz.content || '0').trim(), 10) || 0
                    if (got <= 0) throw new Error(`${prefix} 下载完成但文件为空, HTTP=${httpCode}`)
                    const html = await sh(`head -c 256 ${shellQuote(temp)} 2>/dev/null | grep -Eiq '<(html|!doctype)|<!DOCTYPE' && echo html || echo ok`, 3000)
                    if (/html/.test(html.content || '')) throw new Error(`${prefix} 返回的是网页/目录页，不是目标文件`)
                    if (/\.tar\.gz$/i.test(dest)) {
                        const archive = await sh(`gzip -t ${shellQuote(temp)} && tar -tzf ${shellQuote(temp)} >/dev/null 2>&1 && echo valid`, 15000)
                        if (!archive.success || !/valid/.test(archive.content || '')) throw new Error(`${prefix} 压缩包完整性校验失败`)
                    }
                    const move = await sh(`mv -f ${shellQuote(temp)} ${shellQuote(dest)} && echo committed`, 8000)
                    if (!move.success || !/committed/.test(move.content || '')) throw new Error(`${prefix} 校验通过但原子替换失败: ${move.content || '(空)'}`)
                    committed = true
                    updateProgress(`下载 ${label} ✓`, text + `\n[完成] ${(got / 1024 / 1024).toFixed(2)} MB`)
                    return got
                }
                if (performance.now() - t0 > TIMEOUT) throw new Error(`${prefix} 下载超时 (>10 分钟)`)
                const alive = await sh(`p=$(cat ${shellQuote(pidFile)} 2>/dev/null); [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo alive || echo dead`, 3000)
                if (/dead/.test(alive.content || '') && text) throw new Error(`${prefix} 下载进程意外结束: ${text.slice(-800)}`)
            }
        } finally {
            if (!committed) {
                await sh(`p=$(cat ${shellQuote(pidFile)} 2>/dev/null); [ -n "$p" ] && kill "$p" 2>/dev/null || true; rm -f ${shellQuote(temp)}`, 5000)
            }
            await sh(`rm -f ${shellQuote(pidFile)} ${shellQuote(logFile)}`, 3000)
        }
    }
    const downloadWithProgress = async (urls, dest, dlog, label) => {
        const list = Array.isArray(urls) ? urls : [urls]
        const attempts = []
        for (const url of list) {
            const routes = await networkRoutesForUrl(url)
            routes.forEach(route => attempts.push({ url, route }))
        }
        const errors = []
        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i]
            try { return await downloadOneWithProgress(attempt, dest, dlog, label, i + 1, attempts.length) }
            catch (e) {
                errors.push(`${i + 1}. [${attempt.route.label}] ${attempt.url} -> ${e && e.message || e}`)
                // Keep the last known-good destination intact; failed attempts own only their unique temp files.
                if (i + 1 < attempts.length) updateProgress(`下载 ${label}: 尝试下一种连接方式`, errors.join('\n'))
            }
        }
        throw new Error(`${label} 下载失败，已尝试 ${attempts.length} 种连接方式:\n${errors.join('\n')}`)
    }

    // === Local file upload =================================================
    // Files are sent to the router in small base64 chunks so this also works
    // with the stock /api/run_shell endpoint and BusyBox base64.
    const localFileBytes = async (file) => new Uint8Array(await file.arrayBuffer())
    const localFileB64 = (bytes) => {
        let text = ''
        const STEP = 0x4000
        for (let i = 0; i < bytes.length; i += STEP) {
            const part = bytes.subarray(i, Math.min(i + STEP, bytes.length))
            let bin = ''
            for (let j = 0; j < part.length; j++) bin += String.fromCharCode(part[j])
            text += bin
        }
        return btoa(text)
    }
    const localUploadFile = async (file, dest, label) => {
        const STEP = 0x6000
        const expected = Number(file.size) || 0
        const total = Math.max(1, Math.ceil(expected / STEP))
        const stageDir = `${TRANSFER_DIR}/.local-upload.${transferNonce()}`
        const staged = `${stageDir}/assembled`
        const chunks = []
        const prep = await sh(`mkdir -p ${shellQuote(TRANSFER_DIR)} ${shellQuote(stageDir)} "$(dirname ${shellQuote(dest)})"`, 8000)
        if (!prep.success) throw new Error(`${label} 创建上传暂存区失败: ${prep.content || '(empty)'}`)
        try {
            for (let n = 0; n < total; n++) {
                const from = n * STEP
                const bytes = new Uint8Array(await file.slice(from, Math.min(from + STEP, expected)).arrayBuffer())
                const encoded = localFileB64(bytes)
                const chunkPath = `${stageDir}/part-${String(n + 1).padStart(6, '0')}`
                const r = await sh(`printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(chunkPath)} && test "$(wc -c < ${shellQuote(chunkPath)})" -eq ${bytes.length} && echo ok`, 20000)
                if (!r.success || !/ok/.test(r.content || '')) throw new Error(`${label} 上传分块失败 (${n + 1}/${total}): ${r.content || '(empty)'}`)
                chunks.push(chunkPath)
                updateProgress(`上传 ${label} ...`, `${n + 1}/${total} 分块，${fmtSize(expected)}`)
            }
            const chunkList = chunks.map(shellQuote).join(' ')
            const assemble = await sh(`cat ${chunkList} > ${shellQuote(staged)} && test "$(wc -c < ${shellQuote(staged)})" -eq ${expected} && mv -f ${shellQuote(staged)} ${shellQuote(dest)} && echo committed`, 30000)
            if (!assemble.success || !/committed/.test(assemble.content || '')) throw new Error(`${label} 合并/大小校验失败 (expected=${expected}): ${assemble.content || '(empty)'}`)
            return expected
        } finally {
            await sh(`rm -rf ${shellQuote(stageDir)}`, 8000)
        }
    }
    const localPathOf = (file) => {
        let p = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/').replace(/^\/+/, '')
        const m = p.match(/(?:^|\/)ui\/(.+)$/i)
        if (m) return m[1]
        const parts = p.split('/').filter(Boolean)
        const uiIndex = parts.findIndex(x => x.toLowerCase() === 'ui')
        if (uiIndex >= 0 && parts.length > uiIndex + 1) return parts.slice(uiIndex + 1).join('/')
        const knownIndex = parts.findIndex(x => /^(?:subpages|subpage|pages|functions|function)$/i.test(x))
        if (knownIndex >= 0 && parts.length > knownIndex + 1) return parts.slice(knownIndex).join('/')
        return String(file.name || p).replace(/^.*\//, '')
    }
    const localFilesUnique = () => {
        const all = []
        for (const input of [$localFiles, $localFolder]) {
            if (!input || !input.files) continue
            for (const f of Array.from(input.files)) all.push(f)
        }
        const seen = new Set()
        return all.filter(f => {
            const key = `${f.name}|${f.webkitRelativePath || ''}|${f.size}|${f.lastModified}`
            if (seen.has(key)) return false
            seen.add(key); return true
        })
    }
    const classifyLocalFiles = (files) => {
        const out = { uiArchive: null, devui: null, datad: null, version: null, uiSource: [] }
        for (const f of files) {
            const name = String(f.name || '').toLowerCase()
            const path = String(f.webkitRelativePath || '').replace(/\\/g, '/').toLowerCase()
            if (name === 'ui.tar.gz' || name === 'ui-full.tar.gz' || name === 'ui-fixed.tar.gz' || name === 'u60pro_ui.tar.gz') out.uiArchive = f
            else if (name === 'u60pro-devui-aarch64' || name === 'u60pro-devui.stripped' || name === 'u60pro-devui' || name === 'u60pro-devui.new') out.devui = f
            else if (name === 'zwrt-datad-aarch64' || name === 'zwrt-datad' || name === 'zwrt-datad.new' || name === 'u60-datad') out.datad = f
            else if (name === 'version.json') out.version = f
            else if (/\.(html|css|sh)$/i.test(name) && (/(^|\/)ui\//i.test(path) || /^(?:subpages|subpage|pages|functions|function)\//i.test(localPathOf(f)) || !f.webkitRelativePath)) out.uiSource.push(f)
        }
        return out
    }
    const localVersionFromFile = async (file) => {
        if (!file) return null
        try {
            const value = JSON.parse(await file.text())
            return value && typeof value === 'object' ? value : null
        } catch (e) { throw new Error('version.json \u4e0d\u662f\u6709\u6548\u7684 JSON') }
    }
    const buildLocalUiArchive = async (files) => {
        if (!files.length) return false
        // The official device-side format is a flat tar archive: the archive
        // root contains top-level HTML/CSS plus optional subpages/... files.
        await sh(`rm -rf ${shellQuote(UI_UPLOAD_DIR)}; mkdir -p ${shellQuote(UI_UPLOAD_DIR)}`, 8000)
        const used = new Set()
        for (const f of files) {
            let rel = localPathOf(f).replace(/^\/+/, '')
            rel = rel.replace(/^\.?\//, '')
            if (!rel || rel.includes('..') || rel.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(rel)) continue
            if (!/^(?:[^/]+\.(?:html|css|sh)|(?:subpages|subpage|pages|functions|function)\/[^/]+\.(?:html|css|sh))$/i.test(rel)) continue
            if (used.has(rel)) continue
            used.add(rel)
            await localUploadFile(f, `${UI_UPLOAD_DIR}/${rel}`, `UI/${rel}`)
        }
        if (!used.size) throw new Error('\u9009\u4E2D\u7684\u6587\u4EF6\u4E2D\u6CA1\u6709\u53EF\u7528\u7684 UI HTML/CSS/SH \u6587\u4EF6')
        // BusyBox tar accepts an explicit file list more reliably than `tar ... -- .`.
        // It also avoids adding a leading `./` entry to the release-style archive.
        const list = Array.from(used).map(shellQuote).join(' ')
        const packed = await sh(`cd ${shellQuote(UI_UPLOAD_DIR)} && tar -czf ${shellQuote(TMP_TGZ)} ${list}`, 30000)
        if (!packed.success) throw new Error(`UI \u6253\u5305\u5931\u8D25: ${packed.content || '(empty)'}`)
        const check = await sh(`tar -tzf ${shellQuote(TMP_TGZ)} 2>/dev/null | sed 's#^\\./##'`, 10000)
        const names = String(check.content || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
        const missing = Array.from(used).filter(x => !names.includes(x))
        if (!check.success || missing.length) throw new Error(`UI \u6253\u5305\u6821\u9A8C\u5931\u8D25: ${missing.join(',') || '(archive unreadable)'}`)
        return true
    }

    // === Install UI templates into /data/plugins/u60pro-devui/ui ===
    // Accept both the official flat archive and an archive containing a ui/ directory.
    // Beta packages are accepted only when both signal subpages and the Mihomo tile are present.
    const installUiTemplates = async ({ existing = false } = {}) => {
        if (!existing) {
            await downloadWithProgress(await resolveFileUrl('devui', assetOf('ui')), TMP_TGZ, `${TMP_TGZ}.log`, 'ui-tgz')
        } else {
            const check = await sh(`[ -s ${shellQuote(TMP_TGZ)} ] && echo ok || echo missing`, 5000)
            if (!check.success || !/ok/.test(check.content || '')) throw new Error(`UI archive is missing: ${TMP_TGZ}`)
        }
        const r = await sh(`
mkdir -p ${DEVUI_DIR} ${DATAD_DIR} ${shellQuote(TRANSFER_DIR)} || exit 1
EXTRACT_DIR=${DEVUI_DIR}/ui_extract
UI_DIR=${shellQuote(UI_DIR)}
FUNCTIONS_DIR=${shellQuote(FUNCTIONS_DIR)}
UI_STAGE=${UI_DIR}.new
UI_OLD=${UI_DIR}.old
ARCHIVE_LIST=${TRANSFER_DIR}/.ui-archive-list.$$
if ! tar -tzf ${shellQuote(TMP_TGZ)} > "$ARCHIVE_LIST" 2> "$ARCHIVE_LIST.err"; then
    rm -f "$ARCHIVE_LIST" "$ARCHIVE_LIST.err"; echo "ERROR: UI archive listing failed"; exit 1
fi
# BusyBox tar can strip ../ or / from names even while listing with exit 0.
# Such warnings must be fatal instead of silently trusting the sanitized list.
if [ -s "$ARCHIVE_LIST.err" ]; then
    cat "$ARCHIVE_LIST.err"; rm -f "$ARCHIVE_LIST" "$ARCHIVE_LIST.err"
    echo "ERROR: unsafe or unsupported UI archive paths"; exit 1
fi
# Accept conventional ./ archive prefixes, but reject traversal and special names.
if sed 's#^[.]/##; /^$/d' "$ARCHIVE_LIST" | grep -Eq '(^/|(^|/)[.][.]?(/|$)|[^A-Za-z0-9._/-])'; then
    rm -f "$ARCHIVE_LIST" "$ARCHIVE_LIST.err"; echo "ERROR: unsafe path in UI archive"; exit 1
fi
if tar -tvzf ${shellQuote(TMP_TGZ)} 2>/dev/null | grep -Eq '^[^d-]| -> | link to '; then
    rm -f "$ARCHIVE_LIST" "$ARCHIVE_LIST.err"; echo "ERROR: UI archive must not contain links or special files"; exit 1
fi
rm -f "$ARCHIVE_LIST" "$ARCHIVE_LIST.err"
if [ ! -e ${UI_DIR} ] && [ ! -L ${UI_DIR} ] && { [ -e "$UI_OLD" ] || [ -L "$UI_OLD" ]; }; then
    mv "$UI_OLD" ${UI_DIR} || { echo "ERROR: cannot restore previous UI directory"; exit 1; }
fi
rm -rf "$EXTRACT_DIR" "$UI_STAGE"; mkdir -p "$EXTRACT_DIR"
if ! tar -xzf ${TMP_TGZ} -C "$EXTRACT_DIR" 2>&1; then
    rm -rf "$EXTRACT_DIR"
    mv -f ${TMP_TGZ} ${TMP_TGZ}.failed 2>/dev/null || true
    echo "ERROR: ui.tar.gz is not a valid gzip tar archive (saved as ${TMP_TGZ}.failed)"; exit 1
fi
HTML_DIR=
for d in "$EXTRACT_DIR" "$EXTRACT_DIR/ui" "$EXTRACT_DIR/u60pro-devui/ui" "$EXTRACT_DIR"/ui-* "$EXTRACT_DIR"/*/ui; do
    [ -d "$d" ] || continue
    if find "$d" -maxdepth 1 -type f -name '*.html' 2>/dev/null | grep -q .; then
        HTML_DIR="$d"
        break
    fi
done
if [ -z "$HTML_DIR" ]; then
    for f in $(find "$EXTRACT_DIR" -type f \\( -name '01-signal.html' -o -name '02-functions.html' \\) 2>/dev/null | sort | head -1); do
        HTML_DIR=$(dirname "$f")
        break
    done
fi
if [ -z "$HTML_DIR" ]; then
    for f in $(find "$EXTRACT_DIR" -type f -name '*.html' 2>/dev/null | sort | head -1); do
        HTML_DIR=$(dirname "$f")
        break
    done
fi
if [ -z "$HTML_DIR" ] || [ ! -d "$HTML_DIR" ]; then
    rm -rf "$EXTRACT_DIR"
    echo "ERROR: ui.tar.gz contains no HTML page"; exit 1
fi
for required in 01-signal.html 02-functions.html subpages/cell.html subpages/wifi.html; do
    if [ ! -f "$HTML_DIR/$required" ]; then
        rm -rf "$EXTRACT_DIR"
        echo "ERROR: required UI page is missing: $required"; exit 1
    fi
done
if [ ! -f "$HTML_DIR/functions/clash.html" ] && [ ! -f "$HTML_DIR/functions/mihomo.html" ]; then
    rm -rf "$EXTRACT_DIR"
    echo "ERROR: required transparent-proxy control page is missing (functions/clash.html or functions/mihomo.html)"; exit 1
fi
# Normalize the supplied manifest and merge the files actually shipped. Old
# release manifests sometimes omitted the entire subpages/functions directory.
MANIFEST_SRC="$EXTRACT_DIR/.devui-managed-files.generated"
{
    if [ -f "$HTML_DIR/.devui-managed-files" ]; then
        tr -d '\\r' < "$HTML_DIR/.devui-managed-files"
        printf '\\n'
    fi
    (cd "$HTML_DIR" && find . -type f \\( -name '*.html' -o -name '*.css' -o -name '*.sh' \\) ! -name '.devui-managed-files' 2>/dev/null | sed 's#^[.]/##')
} | sed '/^$/d; /^#/d' | sort -u > "$MANIFEST_SRC"

NEW_MANAGED_COUNT=0
NEW_HTML_COUNT=0
NEW_COUNT=0
NEW_SUB_COUNT=0
NEW_FUNC_COUNT=0
while IFS= read -r rel || [ -n "$rel" ]; do
    case "$rel" in ''|'#'*) continue ;; esac
    if printf '%s\n' "$rel" | grep -Eq '(^/|(^|/)[.][.]?(/|$)|[^A-Za-z0-9._/-])'; then
        rm -rf "$EXTRACT_DIR" "$UI_STAGE"
        echo "ERROR: unsafe UI path: $rel"; exit 1
    fi
    if [ ! -f "$HTML_DIR/$rel" ]; then
        rm -rf "$EXTRACT_DIR" "$UI_STAGE"
        echo "ERROR: UI file is missing: $rel"; exit 1
    fi
    NEW_MANAGED_COUNT=$((NEW_MANAGED_COUNT + 1))
    case "$rel" in *.html) NEW_HTML_COUNT=$((NEW_HTML_COUNT + 1)) ;; esac
    case "$rel" in
        subpages/*.html|subpage/*.html|pages/*.html) NEW_SUB_COUNT=$((NEW_SUB_COUNT + 1)) ;;
        functions/*.html|functions/*.sh|function/*.html|function/*.sh) NEW_FUNC_COUNT=$((NEW_FUNC_COUNT + 1)) ;;
        *.html) NEW_COUNT=$((NEW_COUNT + 1)) ;;
    esac
done < "$MANIFEST_SRC"
if [ "$NEW_HTML_COUNT" -le 0 ]; then
    rm -rf "$EXTRACT_DIR" "$UI_STAGE"
    echo "ERROR: UI archive contains no HTML file"; exit 1
fi
mkdir -p "$UI_STAGE"
if [ -d ${UI_DIR} ]; then
    cp -af ${UI_DIR}/. "$UI_STAGE"/ 2>/dev/null || {
        rm -rf "$EXTRACT_DIR" "$UI_STAGE"
        echo "ERROR: cannot copy existing UI files"; exit 1
    }
fi
if [ -f ${MANAGED_UI_FILES} ]; then
    while IFS= read -r oldrel || [ -n "$oldrel" ]; do
        case "$oldrel" in ''|'#'*) continue ;; esac
        if printf '%s\n' "$oldrel" | grep -Eq '(^/|(^|/)[.][.]?(/|$)|[^A-Za-z0-9._/-])'; then continue; fi
        case "$oldrel" in
            subpages/*.html|subpage/*.html|pages/*.html) [ "$NEW_SUB_COUNT" -le 0 ] && continue ;;
        esac
        rm -f "$UI_STAGE/$oldrel"
    done < ${MANAGED_UI_FILES}
else
    find "$UI_STAGE" -maxdepth 1 -type f \\( -name '*.html' -o -name '*.css' \\) -exec rm -f {} ';' 2>/dev/null || true
    # Preserve user-managed files and remove only files listed by the previous manifest.
fi
while IFS= read -r rel || [ -n "$rel" ]; do
    case "$rel" in ''|'#'*) continue ;; esac
    mkdir -p "$(dirname "$UI_STAGE/$rel")" || exit 1
    cp -pf "$HTML_DIR/$rel" "$UI_STAGE/$rel" 2>/dev/null || {
        rm -rf "$EXTRACT_DIR" "$UI_STAGE"
        echo "ERROR: cannot stage UI file: $rel"; exit 1
    }
done < "$MANIFEST_SRC"
cp -f "$MANIFEST_SRC" "$UI_STAGE/.devui-managed-files" || exit 1
for required in 01-signal.html 02-functions.html subpages/cell.html subpages/wifi.html; do
    [ -s "$UI_STAGE/$required" ] || { echo "ERROR: required staged page is missing: $required"; exit 1; }
done
[ -f "$UI_STAGE/functions/cpuctl.sh" ] && chmod 755 "$UI_STAGE/functions/cpuctl.sh"
[ -f "$UI_STAGE/functions/fmsimpin.sh" ] && chmod 755 "$UI_STAGE/functions/fmsimpin.sh"
STAGED_PRESENT=0
while IFS= read -r rel || [ -n "$rel" ]; do
    case "$rel" in ''|'#'*) continue ;; esac
    [ -f "$UI_STAGE/$rel" ] && STAGED_PRESENT=$((STAGED_PRESENT + 1))
done < "$UI_STAGE/.devui-managed-files"
if [ "$STAGED_PRESENT" -ne "$NEW_MANAGED_COUNT" ]; then
    rm -rf "$EXTRACT_DIR" "$UI_STAGE"
    echo "ERROR: staged UI file count mismatch (expected=$NEW_MANAGED_COUNT staged=$STAGED_PRESENT)"; exit 1
fi
rm -rf "$UI_OLD"
if [ -e ${UI_DIR} ] || [ -L ${UI_DIR} ]; then
    mv ${UI_DIR} "$UI_OLD" || {
        rm -rf "$EXTRACT_DIR" "$UI_STAGE"
        echo "ERROR: cannot move current UI to backup"; exit 1
    }
fi
if ! mv "$UI_STAGE" ${UI_DIR}; then
    [ -e "$UI_OLD" ] && mv "$UI_OLD" ${UI_DIR}
    rm -rf "$EXTRACT_DIR"
    echo "ERROR: cannot activate staged UI"; exit 1
fi
POST_PRESENT=0
while IFS= read -r rel || [ -n "$rel" ]; do
    case "$rel" in ''|'#'*) continue ;; esac
    [ -f "${UI_DIR}/$rel" ] && POST_PRESENT=$((POST_PRESENT + 1))
done < "$UI_DIR/.devui-managed-files"
if [ "$POST_PRESENT" -ne "$NEW_MANAGED_COUNT" ]; then
    rm -rf ${UI_DIR}; [ -e "$UI_OLD" ] && mv "$UI_OLD" ${UI_DIR}
    rm -rf "$EXTRACT_DIR"
    echo "ERROR: installed UI file count mismatch (expected=$NEW_MANAGED_COUNT installed=$POST_PRESENT)"; exit 1
fi
COUNT=$(find ${UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
SUB_COUNT=$(find ${UI_DIR} -type f \\( -path '*/subpages/*.html' -o -path '*/subpage/*.html' -o -path '*/pages/*.html' \\) 2>/dev/null | wc -l | tr -d ' ')
FUNC_COUNT=$(find ${FUNCTIONS_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
rm -rf "$UI_OLD" "$EXTRACT_DIR" ${TMP_TGZ}
echo "OK ($COUNT html, $SUB_COUNT subpages, $FUNC_COUNT functions, $POST_PRESENT/$NEW_MANAGED_COUNT managed files)"
`, 60000)
        if (!r.success || !/OK/.test(r.content || '')) throw new Error(`UI install failed: ${r.content || '(empty)'}`)
    }

    // === 二进制下载 (先下到 .new, 避免覆盖运行中的可执行文件 ETXTBSY) ===
    const downloadBinaryToNew = async (key) => {
        const c = COMP[key]
        const tmp = `${c.bin}.new`
        await downloadWithProgress(await resolveFileUrl(c.which, assetOf(key)), tmp, `${tmp}.log`, key)
        return tmp
    }

    const installSupportFiles = async () => {
        await ensurePluginDirs({ force: true })
        const r = await sh(`
mkdir -p ${DATAD_DIR} ${REQUIRED_PLUGIN_DIRS_SH} || exit 1
[ -f ${LEGACY_DIR}/devui.conf ] && [ ! -f ${DEVUI_DIR}/devui.conf ] && cp -f ${LEGACY_DIR}/devui.conf ${DEVUI_DIR}/devui.conf
[ -f ${LEGACY_UI_DIR}/.lockpin ] && [ ! -f ${UI_DIR}/.lockpin ] && cp -af ${LEGACY_UI_DIR}/.lockpin ${UI_DIR}/.lockpin 2>/dev/null
OLD_UI_COUNT=$(find ${LEGACY_UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
NEW_UI_COUNT=$(find ${UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NEW_UI_COUNT" -le 0 ] && [ "$OLD_UI_COUNT" -gt 0 ]; then
    cp -af ${LEGACY_UI_DIR}/. ${UI_DIR}/ 2>/dev/null || true
fi
cat > ${DEVUI_START_SH} <<'EOF'
${DEVUI_START_SH_CONTENT}
EOF
cat > ${DATAD_START_SH} <<'EOF'
${DATAD_START_SH_CONTENT}
EOF
chmod 755 ${DEVUI_START_SH} ${DATAD_START_SH}
rm -f ${DEVUI_DIR}/u60pro_ui.tar.gz ${DEVUI_DIR}/ui.tar.gz ${DEVUI_DIR}/boot-trace.log.tmp 2>/dev/null
rm -rf ${DEVUI_DIR}/ui_extract 2>/dev/null
echo ok`, 15000)
        if (!r.success || !/ok/.test(r.content || '')) throw new Error(`写入启动脚本失败: ${r.content || '(空)'}`)
    }

    const cleanupLegacyResidue = async () => {
        await ensurePluginDirs({ force: true })
        const r = await sh(`
mkdir -p ${DATAD_DIR} ${REQUIRED_PLUGIN_DIRS_SH} || exit 1
[ -f ${LEGACY_DIR}/devui.conf ] && [ ! -f ${DEVUI_DIR}/devui.conf ] && cp -f ${LEGACY_DIR}/devui.conf ${DEVUI_DIR}/devui.conf
[ -f ${LEGACY_UI_DIR}/.lockpin ] && [ ! -f ${UI_DIR}/.lockpin ] && cp -af ${LEGACY_UI_DIR}/.lockpin ${UI_DIR}/.lockpin 2>/dev/null
OLD_UI_COUNT=$(find ${LEGACY_UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
NEW_UI_COUNT=$(find ${UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NEW_UI_COUNT" -le 0 ] && [ "$OLD_UI_COUNT" -gt 0 ]; then
    cp -af ${LEGACY_UI_DIR}/. ${UI_DIR}/ 2>/dev/null || true
fi
/etc/init.d/u60pro-devui disable 2>/dev/null
/etc/init.d/u60-datad disable 2>/dev/null
/etc/init.d/zwrt-datad disable 2>/dev/null
/etc/init.d/u60pro-devui stop 2>/dev/null
/etc/init.d/u60-datad stop 2>/dev/null
/etc/init.d/zwrt-datad stop 2>/dev/null
rm -f /etc/init.d/u60pro-devui /etc/init.d/u60-datad /etc/init.d/zwrt-datad
rm -f /etc/rc.d/S*u60pro-devui /etc/rc.d/K*u60pro-devui /etc/rc.d/S*u60-datad /etc/rc.d/K*u60-datad /etc/rc.d/S*zwrt-datad /etc/rc.d/K*zwrt-datad
[ -f ${RCLOCAL} ] && {
    sed -i '\\#${LEGACY_DIR}/start\\.sh#d' ${RCLOCAL}
    sed -i '\\#${LEGACY_START_SH}#d' ${RCLOCAL}
    sed -i '\\#${DATAD_LEGACY_START_SH}#d' ${RCLOCAL}
    sed -i '\\#${DEVUI_BIN}#d' ${RCLOCAL}
    sed -i '\\#${DATAD_BIN}#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/u60pro-devui#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/zwrt-datad#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/u60-datad#d' ${RCLOCAL}
    sed -i '/#[[:space:]]*${BOOT_KEY}[[:space:]]*$/d' ${RCLOCAL}
    sed -i '/u60-datad/d' ${RCLOCAL}
}
killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null
rm -f ${DATAD_DIR}/u60-datad
rm -f ${LEGACY_START_SH}
rm -f ${DATAD_LEGACY_START_SH}
rm -rf ${LEGACY_DIR}
rm -rf ${LEGACY_UI_DIR}
echo ok`, 15000)
        if (!r.success || !/ok/.test(r.content || '')) throw new Error(`清理旧版残留失败: ${r.content || '(空)'}`)
        await installSupportFiles()
    }

    // === 服务控制 ===
    const stopZteRuntime = async () => {
        await sh(`
${ZTE_SVC} stop 2>/dev/null
i=0; while [ $i -lt 10 ]; do
    PIDS=$(pidof ${ZTE_PROC} 2>/dev/null || :)
    [ -z "$PIDS" ] && break
    for p in $PIDS; do kill -9 $p 2>/dev/null || :; done
    sleep 0.2; i=$((i+1))
done
echo ok`, 10000)
    }
    const startOurServices = async ({ datad = true, devui = true } = {}) => {
        if (!datad && !devui) return
        await installSupportFiles()
        const needDatad = !!(datad || devui)
        const r = await sh(`
if [ ${needDatad ? '1' : '0'} = 1 ] && [ ! -x ${shellQuote(DATAD_BIN)} ]; then echo "ERROR: missing executable ${DATAD_BIN}"; exit 1; fi
if [ ${devui ? '1' : '0'} = 1 ] && [ ! -x ${shellQuote(DEVUI_BIN)} ]; then echo "ERROR: missing executable ${DEVUI_BIN}"; exit 1; fi
${devui ? `killall -9 ${DEVUI_PROC} 2>/dev/null || true` : ':'}
${datad ? `killall -9 ${DATAD_PROC} 2>/dev/null || true; killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null || true` : ':'}
sleep 0.3
if [ ${datad ? '1' : '0'} = 1 ] || ! pidof ${DATAD_PROC} >/dev/null 2>&1; then
    nohup env U60_FORCE_DATAD=1 sh ${shellQuote(DATAD_START_SH)} >/dev/null 2>&1 </dev/null &
fi
sleep 1
${devui ? `nohup sh ${shellQuote(DEVUI_START_SH)} legacy >/dev/null 2>&1 </dev/null &` : ':'}
sleep 2
echo ok`, 20000)
        if (!r.success || !/ok/.test(r.content || '')) {
            throw new Error(`服务启动脚本执行失败: ${r.content || '(empty)'}`)
        }
    }
    const stopOurServices = async ({ datad = true, devui = true } = {}) => {
        const kills = []
        if (devui) kills.push(`killall -9 ${DEVUI_PROC} 2>/dev/null || true`)
        if (datad) kills.push(`killall -9 ${DATAD_PROC} 2>/dev/null || true`, `killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null || true`)
        if (!kills.length) return
        await sh(`${kills.join('; ')}; sleep 0.2; echo ok`, 5000)
    }
    const restoreZte = async () => {
        await sh(`${ZTE_SVC} enable 2>/dev/null; ${ZTE_SVC} start 2>/dev/null; sleep 1; echo ok`, 10000)
    }
    const verifyRunning = async ({ datad = true, devui = true } = {}) => {
        const checks = []
        if (datad || devui) checks.push(`pidof ${DATAD_PROC} >/dev/null 2>&1`)
        if (devui) checks.push(`pidof ${DEVUI_PROC} >/dev/null 2>&1`)
        if (!checks.length) return true
        for (let i = 0; i < 8; i++) {
            const r = await sh(`${checks.join(' && ')} && echo yes || echo no`, 5000)
            if (/yes/.test(r.content || '')) return true
            await wait(1000)
        }
        return false
    }
    // === 持久化: /etc/rc.local ===
    const ensureLegacyCleanupBeforeBoot = async () => {
        const s = await queryStatus()
        if (s.LEGACY_RESIDUE !== 'yes') return
        if (!(await confirmLegacyCleanup(s.LEGACY_ITEMS))) {
            throw new Error('检测到旧版自启残留，已取消写入开机自启。请先清理旧启动逻辑。')
        }
        await cleanupLegacyResidue()
    }

    const setBoot = async (enable) => {
        if (enable) {
            await ensureLegacyCleanupBeforeBoot()
            await installSupportFiles()
        }
        const r = await sh(`
RC='${RCLOCAL}'
KEY_DEVUI='${BOOT_KEY_DEVUI}'; KEY_DATAD='${BOOT_KEY_DATAD}'
LINE_DATAD='${BOOT_LINE_DATAD}'
LINE_DEVUI='${BOOT_LINE_DEVUI}'
ENABLE=${enable ? '1' : '0'}
TMP=$RC.u60.tmp.$$
OUT=$RC.u60.out.$$
trap 'rm -f "$TMP" "$OUT"' EXIT HUP INT TERM
if [ "$ENABLE" = 0 ] && [ ! -f "$RC" ]; then echo ok; exit 0; fi
if [ -f "$RC" ]; then
    tr -d '\\r' < "$RC" > "$TMP" || exit 1
else
    printf '#!/bin/sh\\nexit 0\\n' > "$TMP" || exit 1
fi
sed "/$KEY_DEVUI/d; /$KEY_DATAD/d; /#[[:space:]]*${BOOT_KEY}[[:space:]]*$/d" "$TMP" > "$OUT" || exit 1
mv -f "$OUT" "$TMP" || exit 1
if [ "$ENABLE" = 1 ]; then
    if grep -q '^exit 0$' "$TMP"; then
        awk -v datad="$LINE_DATAD" -v devui="$LINE_DEVUI" 'BEGIN { inserted=0 } !inserted && $0=="exit 0" { print datad; print devui; inserted=1 } { print }' "$TMP" > "$OUT" || exit 1
    else
        cat "$TMP" > "$OUT" && printf '%s\\n%s\\n' "$LINE_DATAD" "$LINE_DEVUI" >> "$OUT" || exit 1
    fi
else
    cat "$TMP" > "$OUT" || exit 1
fi
chmod 755 "$OUT" || exit 1
mv -f "$OUT" "$RC" || exit 1
rm -f "$TMP"
echo ok`, 5000)
        if (!r.success || !/ok/.test(r.content || '')) throw new Error(`${enable ? '写入' : '清理'} rc.local 失败: ${r.content || '(空)'}`)
    }
    // === 彻底卸载: 停进程 → 恢复原厂 → 清 rc.local → 删 /data/plugins + /data/u60pro + 旧 /data/ui ===
    const fullUninstall = async () => {
        const r = await sh(`
killall -9 ${DEVUI_PROC} 2>/dev/null
killall -9 ${DATAD_PROC} 2>/dev/null
killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null
/etc/init.d/u60pro-devui disable 2>/dev/null
/etc/init.d/zwrt-datad disable 2>/dev/null
/etc/init.d/u60-datad disable 2>/dev/null
/etc/init.d/u60pro-devui stop 2>/dev/null
/etc/init.d/zwrt-datad stop 2>/dev/null
/etc/init.d/u60-datad stop 2>/dev/null
rm -f /etc/rc.d/S*u60pro-devui /etc/rc.d/K*u60pro-devui /etc/rc.d/S*zwrt-datad /etc/rc.d/K*zwrt-datad /etc/rc.d/S*u60-datad /etc/rc.d/K*u60-datad
rm -f /etc/init.d/u60pro-devui /etc/init.d/zwrt-datad /etc/init.d/u60-datad
${ZTE_SVC} enable 2>/dev/null; ${ZTE_SVC} start 2>/dev/null
[ -f ${RCLOCAL} ] && {
    sed -i '/${BOOT_KEY}/d' ${RCLOCAL}
    sed -i '\\#${LEGACY_DIR}/start\\.sh#d' ${RCLOCAL}
    sed -i '\\#${LEGACY_START_SH}#d' ${RCLOCAL}
    sed -i '\\#${DATAD_LEGACY_START_SH}#d' ${RCLOCAL}
    sed -i '\\#${DEVUI_BIN}#d' ${RCLOCAL}
    sed -i '\\#${DATAD_BIN}#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/u60pro-devui#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/zwrt-datad#d' ${RCLOCAL}
    sed -i '\\#/etc/init.d/u60-datad#d' ${RCLOCAL}
    sed -i '/u60-datad/d' ${RCLOCAL}
}
rm -rf ${DEVUI_DIR}
rm -rf ${DATAD_DIR}
rm -rf ${LEGACY_DIR}
rm -rf ${LEGACY_UI_DIR}
echo ok`, 15000)
        if (!r.success) throw new Error(r.content || '(空)')
    }

    // ====================== UI ======================
    await waitForBody()

    const html = `
<div class="mask" id="${MODAL_ID}" style="display:none;top:0;left:0;right:0;bottom:0;">
    <div class="modal" style="width:96%;max-width:440px;display:flex;flex-direction:column;max-height:94vh;padding:14px">
        <div class="title" style="margin-bottom:4px;"><span>U60 屏幕管理</span></div>
        <div style="font-size:10px;margin-bottom:4px;">
            <i style="color:yellow;">⚠️ 会接管原厂 <code>zte_topsw_devui</code> 小屏。安装先下载再切换、失败自动回退原厂；首次安装不会自动写开机自启，未写自启前重启即可恢复原厂。</i>
        </div>
        <style>
            #${MODAL_ID} code{font-size:10px;background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px;font-family:monospace}
            #${MODAL_ID} .u60_src_row{display:flex;gap:8px;align-items:center;margin:8px 0 2px;font-size:12px}
            #${MODAL_ID} .u60_src_row select{flex:1;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid #888;background:transparent;color:inherit;font-size:12px}
            #${MODAL_ID} .u60_custom_box{display:none;margin:6px 0 4px;padding:8px 9px;border-radius:8px;border:1px solid rgba(247,198,107,.35);background:rgba(247,198,107,.08)}
            #${MODAL_ID} .u60_custom_box input{width:100%;box-sizing:border-box;padding:7px 8px;border-radius:6px;border:1px solid #888;background:transparent;color:inherit;font-size:12px}
            #${MODAL_ID} .u60_custom_warn{margin-top:6px;font-size:11px;line-height:1.45;color:#f7c66b}
            #${MODAL_ID} .u60_custom_tip{margin-top:4px;font-size:10px;line-height:1.45;opacity:.7}
            #${MODAL_ID} .u60_stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 2px}
            #${MODAL_ID} .u60_stat{position:relative;background:var(--dark-card-bg,rgba(255,255,255,.04));border:1px solid var(--dark-border-color,rgba(255,255,255,.08));border-radius:12px;padding:12px 6px 10px;text-align:center;overflow:hidden}
            #${MODAL_ID} .u60_stat::after{content:'';position:absolute;left:0;top:0;height:3px;width:100%;background:rgba(255,255,255,.06)}
            #${MODAL_ID} .u60_stat.ok::after{background:#1a7a3a}
            #${MODAL_ID} .u60_stat.warn::after{background:#7a5a1a}
            #${MODAL_ID} .u60_stat.bad::after{background:#7a1a1a}
            #${MODAL_ID} .u60_stat.ok{border-color:rgba(26,122,58,.45);background:rgba(26,122,58,.08)}
            #${MODAL_ID} .u60_stat.warn{border-color:rgba(122,90,26,.45);background:rgba(122,90,26,.08)}
            #${MODAL_ID} .u60_stat.bad{border-color:rgba(122,26,26,.45);background:rgba(122,26,26,.06)}
            #${MODAL_ID} .u60_stat_icon{font-size:22px;line-height:1;margin-bottom:4px}
            #${MODAL_ID} .u60_stat_value{font-size:13px;font-weight:700;margin-bottom:2px;word-break:break-all}
            #${MODAL_ID} .u60_stat_sub{font-size:10px;opacity:.7;line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            #${MODAL_ID} .u60_stat_label{font-size:10px;opacity:.55;margin-top:3px;letter-spacing:.3px}
            #${MODAL_ID} .u60_actions{display:flex;flex-direction:column;gap:8px;margin-top:10px}
            #${MODAL_ID} .u60_actions button{padding:10px 14px;font-size:14px;width:100%;border-radius:8px}
            #${MODAL_ID} .u60_primary{background:var(--dark-btn-color-active,#1a7a3a);color:#fff;font-weight:600}
            #${MODAL_ID} .u60_update{background:#1a4d7a;color:#fff;font-weight:600}
            #${MODAL_ID} .u60_comp_updates{display:flex;flex-direction:column;gap:6px;margin-top:6px}
            #${MODAL_ID} .u60_comp_updates button{padding:8px 12px;font-size:12px;width:100%;border-radius:8px;background:#1a4d7a;color:#fff}
            #${MODAL_ID} .u60_more{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;justify-content:center}
            #${MODAL_ID} .u60_more button{padding:6px 10px;font-size:11px}
            #${MODAL_ID} .u60_danger{color:tomato}
        </style>

        <div class="u60_src_row">
            <span>更新源</span>
            <select id="u60_src_sel"></select>
        </div>
        <div class="u60_custom_box" id="u60_custom_box">
            <input id="u60_custom_url" type="text" autocomplete="off" spellcheck="false" placeholder="粘贴你的自定义源链接（目录 / 直链 / 模板）">
            <div class="u60_custom_warn">⚠️ 自定义链接由你自行提供，插件不保证自定义链接文件安全，请确认来源可信后再安装/更新。</div>
            <div class="u60_custom_tip">可填目录、直链或模板。插件会自动探测同目录下的 <code>version.json</code>、<code>zwrt-datad-aarch64</code>、<code>u60pro-devui-aarch64</code>、<code>ui.tar.gz</code>，也兼容 <code>{which}</code> / <code>{repo}</code> / <code>{file}</code> 模板。</div>
        </div>

        <div class="u60_custom_box" id="u60_local_box" style="display:block;background:rgba(74,144,226,.08);border-color:rgba(74,144,226,.35)">
            <div style="font-size:11px;line-height:1.45;margin-bottom:6px;">\u2b06\ufe0f <b>\u672c\u5730\u5b89\u88c5</b>\uFF1A\u53EF\u9009\u62E9 release \u6587\u4EF6\uFF0C\u6216\u76F4\u63A5\u9009\u62E9\u6E90\u7801\u4ED3\u5E93\u4E2D\u7684 <code>ui</code> \u6587\u4EF6\u5939\u3002</div>
            <input id="u60_local_files" type="file" multiple style="width:100%;font-size:11px;margin-bottom:5px">
            <input id="u60_local_folder" type="file" webkitdirectory directory multiple style="width:100%;font-size:11px;margin-bottom:6px">
            <button class="btn" id="u60_local_upload" type="button" style="width:100%;padding:8px 10px;background:#1a4d7a;color:#fff">\u4E0A\u4F20\u5E76\u5B89\u88C5\u672C\u5730\u6587\u4EF6</button>
            <div style="font-size:10px;line-height:1.45;opacity:.72;margin-top:5px;">\u652F\u6301 <code>ui.tar.gz</code>\u3001<code>ui-full.tar.gz</code>\u3001\u4E24\u4E2A\u4E8C\u8FDB\u5236\u6587\u4EF6\u3001<code>version.json</code>\uFF1B\u6E90\u7801\u6587\u4EF6\u4F1A\u81EA\u52A8\u6253\u5305\u5230\u8BBE\u5907\u7684 UI \u76EE\u5F55\u3002</div>
        </div>

        <div class="u60_stats" id="u60_state"></div>

        <div class="u60_actions">
            <button class="btn u60_primary" id="u60_install">⚡ 一键安装</button>
        </div>
        <div class="u60_comp_updates" id="u60_comp_updates"></div>

        <div class="u60_more">
            <button class="btn" id="u60_start">启动</button>
            <button class="btn" id="u60_stop">停止</button>
            <button class="btn" id="u60_restart">重启</button>
            <button class="btn" id="u60_persist">切换自启</button>
            <button class="btn" id="u60_refresh">刷新</button>
            <button class="btn" id="u60_reinstall_ui">重装UI</button>
            <button class="btn" id="u60_diagnostic">插件诊断</button>
        </div>
        <div class="u60_more">
            <button class="btn u60_danger" id="u60_restore">还原 ZTE 原厂</button>
            <button class="btn u60_danger" id="u60_uninstall">彻底卸载</button>
        </div>
        <div class="btn" style="text-align:right;margin-top:8px">
            <button type="button" onclick="closeModal('#${MODAL_ID}')">关闭</button>
        </div>
    </div>
</div>`
    const tmp = document.createElement('div')
    tmp.innerHTML = html.trim()
    document.body.appendChild(tmp.firstElementChild)

    const $ = sel => document.querySelector(sel)
    const $state = $('#u60_state')
    const $btnInstall = $('#u60_install')
    const $compUpdates = $('#u60_comp_updates')
    const $srcSel = $('#u60_src_sel')
    const $customBox = $('#u60_custom_box')
    const $customUrl = $('#u60_custom_url')
    const $localFiles = $('#u60_local_files')
    const $localFolder = $('#u60_local_folder')
    const $localUpload = $('#u60_local_upload')

    let fallbackToastSeq = 0
    const toast = (m, c, t) => {
        const message = String(m == null ? '' : m)
        const color = c || ''
        const timeout = t || 2500
        try {
            if (typeof createToast === 'function' && document.querySelector('#toastContainer')) {
                createToast(message, color, timeout)
                return
            }
        } catch (e) { LOG('createToast failed', e) }
        try {
            if (typeof createFixedToast === 'function') {
                const seq = ++fallbackToastSeq
                const safe = message.replace(/[&<>"']/g, ch =>
                    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
                const { el, close } = createFixedToast('u60_devui_action_toast',
                    `<div style="min-width:220px;text-align:center;font-size:12px;line-height:1.5;">${safe}</div>`)
                if (el && color) el.style.color = color
                setTimeout(() => { if (seq === fallbackToastSeq) { try { close() } catch (e) {} } }, timeout)
                return
            }
        } catch (e) { LOG('createFixedToast fallback failed', e) }
        try { alert(message) } catch (e) { LOG('toast alert fallback failed', e) }
    }
    const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const fmtSize = (n) => {
        n = Number(n) || 0
        if (n < 1024) return `${n}B`
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
        return `${(n / 1024 / 1024).toFixed(2)}MB`
    }
    const fmtLegacyItems = (s) => String(s || '')
        .split(';')
        .map(x => x.trim())
        .filter(Boolean)

    const showDiagnosticModal = (content) => {
        const id = 'u60_devui_diagnostic_modal'
        const old = document.getElementById(id)
        if (old) old.remove()
        const mask = document.createElement('div')
        mask.className = 'mask'
        mask.id = id
        mask.style.cssText = 'top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:100000;'
        mask.innerHTML = `
          <div class="modal" style="width:94%;max-width:520px;max-height:88vh;padding:14px;display:flex;flex-direction:column;gap:10px;">
            <div class="title"><span>插件诊断</span></div>
            <textarea readonly spellcheck="false" style="width:100%;height:58vh;box-sizing:border-box;resize:none;padding:9px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(0,0,0,.28);color:inherit;font:11px/1.45 monospace;white-space:pre;overflow:auto;">${escapeHtml(content)}</textarea>
            <div style="display:flex;gap:8px;">
              <button class="btn" data-copy style="flex:1;">复制诊断</button>
              <button class="btn" data-close style="flex:1;">关闭</button>
            </div>
          </div>`
        document.body.appendChild(mask)
        const textarea = mask.querySelector('textarea')
        mask.querySelector('[data-close]').onclick = () => mask.remove()
        mask.querySelector('[data-copy]').onclick = async () => {
            let copied = false
            try {
                await navigator.clipboard.writeText(String(content || ''))
                copied = true
            } catch (e) {
                try {
                    textarea.focus(); textarea.select()
                    copied = document.execCommand('copy')
                } catch (ee) {}
            }
            toast(copied ? '诊断信息已复制' : '复制失败，请长按文本手动复制', copied ? 'green' : 'red', 2500)
        }
    }

    const collectDiagnostic = async () => {
        const uiVersion = getVer('ui') || '(unknown)'
        const devuiVersion = getVer('devui') || '(unknown)'
        const datadVersion = getVer('datad') || '(unknown)'
        const r = await sh(`
OUT=${DIAGNOSTIC_FILE}
pid=$(pidof ${DEVUI_PROC} 2>/dev/null | awk '{print $1}')
[ -n "$pid" ] && kill -USR1 "$pid" 2>/dev/null
sleep 1
{
echo "U60Pro DevUI diagnostic"
echo "generated=$(date '+%F %T %z')"
echo "uname=$(uname -a)"
printf 'versions: datad=%s devui=%s ui=%s\n' ${shellQuote(datadVersion)} ${shellQuote(devuiVersion)} ${shellQuote(uiVersion)}
echo
echo "[processes]"
for proc in ${DEVUI_PROC} ${DATAD_PROC} tailscaled mihomo; do
    pids=$(pidof "$proc" 2>/dev/null)
    echo "$proc pids=$pids"
done
echo
echo "[binaries]"
for bin in ${DEVUI_BIN} ${DATAD_BIN}; do
    if [ -f "$bin" ]; then
        ls -l "$bin"
        command -v sha256sum >/dev/null 2>&1 && sha256sum "$bin"
    else
        echo "missing $bin"
    fi
done
echo
echo "[ui integrity]"
echo "top-level html=$(find ${UI_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')"
echo "subpages=$(find ${SUBPAGES_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')"
echo "functions=$(find ${FUNCTIONS_DIR} -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')"
echo "managed manifest=$([ -f ${MANAGED_UI_FILES} ] && echo present || echo missing)"
[ -f ${MANAGED_UI_FILES} ] && sed 's/^/managed: /' ${MANAGED_UI_FILES}
find ${FUNCTIONS_DIR} -maxdepth 1 -type f 2>/dev/null | sort | while IFS= read -r f; do ls -l "$f"; done
echo
inspect_path() {
    role=$1; path=$2
    if [ ! -e "$path" ]; then echo "$role missing $path"; return; fi
    state=present
    [ -r "$path" ] || state="$state,not-readable"
    [ -x "$path" ] && state="$state,executable"
    echo "$role $state $path"
}
echo "[plugin candidates]"
for base in /data/plugins/tailscale /data/ufi-tools/tailscale /data/kano_plugins/tailscale; do
    inspect_path tailscale-dir "$base"; inspect_path tailscale-ctl "$base/tsctl.sh"; inspect_path tailscale-core "$base/bin/tailscale"
done
for base in /data/plugins/U60Proxy /data/plugins/mihomo /data/ufi-tools/mihomo /data/kano_plugins/mihomo; do
    inspect_path mihomo-dir "$base"; inspect_path mihomo-ctl "$base/mm.sh"; inspect_path mihomo-core "$base/mihomo"
done
for base in /data/plugins/wireguard /data/ufi-tools/wireguard /data/kano_plugins/wireguard; do
    inspect_path wireguard-dir "$base"; inspect_path wireguard-ctl "$base/wgctl.sh"; inspect_path wireguard-core "$base/bin/wg"
done
for base in /data/plugins/operator-lock /data/ufi-tools/operator-lock /data/kano_plugins/operator-lock; do
    inspect_path operator-dir "$base"; inspect_path operator-ctl "$base/operatorctl.sh"; inspect_path operator-config "$base/config.json"
done
inspect_path cpu-ctl ${FUNCTIONS_DIR}/cpuctl.sh
inspect_path cpu-governor /sys/devices/system/cpu/cpufreq/policy0/scaling_governor
inspect_path flymodem-page ${FUNCTIONS_DIR}/fmswitch.html
inspect_path flymodem-ctl ${FUNCTIONS_DIR}/fmsimpin.sh
echo
echo "[capabilities]"
health=$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9460/healthz 2>/dev/null)
state=$(curl -sS --max-time 2 http://127.0.0.1:9460/state 2>/dev/null)
traffic=$(printf '%s' "$state" | jsonfilter -e '@.sim_traffic.available' 2>/dev/null)
echo "datad health_http=$health sim_traffic_available=$traffic"
sim=$(ubus -t 4 call zwrt_zte_mdm.api get_sim_info_before '{}' 2>/dev/null)
dual=$(printf '%s' "$sim" | jsonfilter -e '@.support_dual_sim' 2>/dev/null)
slot=$(printf '%s' "$sim" | jsonfilter -e '@.current_sim_slot' 2>/dev/null)
echo "dual_sim support=$dual current_slot=$slot"
fm=$(ubus -t 4 call zwrt_zte_mdm.api get_sim_info '{}' 2>/dev/null)
fm_flag=$(printf '%s' "$fm" | jsonfilter -e '@.seecom_card_flag' 2>/dev/null)
fm_type=$(printf '%s' "$fm" | jsonfilter -t '@.seecom_card_flag' 2>/dev/null)
echo "flymodem flag_type=$fm_type flag=$fm_flag"
echo
echo "[flymodem detector]"
if [ -r ${FUNCTIONS_DIR}/fmsimpin.sh ]; then
    sh ${FUNCTIONS_DIR}/fmsimpin.sh status 2>&1 || echo "fmsimpin status failed rc=$?"
else
    echo "fmsimpin.sh missing or unreadable"
fi
echo
echo "[devui plugin detection]"
tail -n 200 /data/plugins/u60pro-devui/plugin-detect.log 2>/dev/null || echo "plugin-detect.log missing"
} > "$OUT"
cat "$OUT"
`, 15000)
        if (!r.success) throw new Error(`生成诊断失败: ${r.content || '(空)'}`)
        return r.content || `诊断已保存到 ${DIAGNOSTIC_FILE}`
    }

    let currentStatus = null
    let busy = false
    let remoteVers = { datad: null, devui: null, ui: null }
    let versionFetchSeq = 0
    const assetOf = (key) => (remoteVers[key] && remoteVers[key].asset) || COMP[key].asset
    const markInstalledVersion = (key) => {
        const rv = remoteVerOf(key)
        if (rv) setVer(key, rv)
        else if (usingCustomSrc()) setVer(key, 'custom')
    }

    const uiIntegrity = (status = currentStatus || {}) => {
        const uiCount = parseInt(status.UI_FILES, 10) || 0
        const subpageCount = parseInt(status.SUBPAGE_FILES, 10) || 0
        const functionCount = parseInt(status.FUNCTION_FILES, 10) || 0
        const managedExpected = parseInt(status.MANAGED_FILES_EXPECTED, 10) || 0
        const managedPresent = parseInt(status.MANAGED_FILES_PRESENT, 10) || 0
        const managedFunctionExpected = parseInt(status.MANAGED_FUNCTION_EXPECTED, 10) || 0
        const managedFunctionPresent = parseInt(status.MANAGED_FUNCTION_PRESENT, 10) || 0
        const versionHint = `${getVer('ui')} ${remoteVerOf('ui')}`
        const remixExpected = /-remix\./.test(versionHint)
        const fallbackExpected = remixExpected ? REMIX_FUNCTION_FILES.length : 0
        const fallbackPresent = parseInt(status.REMIX_FUNCTION_PRESENT, 10) || 0
        const expectedFunctions = fallbackExpected > 0 ? fallbackExpected : managedFunctionExpected
        const presentFunctions = fallbackExpected > 0 ? fallbackPresent : managedFunctionPresent
        const missing = [
            managedExpected > 0 ? String(status.MISSING_MANAGED_FILES || '') : '',
            fallbackExpected > 0 ? String(status.REMIX_MISSING_FUNCTION_FILES || '') : ''
        ].filter(Boolean).join(',')
        // 原版归档可能不含二级页面，以受管清单和实际文件判断完整性。
        // 没有清单时保留对原版布局的兼容。
        const templatesPresent = uiCount > 0
        const managedComplete = managedExpected <= 0 || managedPresent === managedExpected
        const functionsComplete = fallbackExpected <= 0 || fallbackPresent === fallbackExpected
        return {
            uiCount, subpageCount, functionCount, managedExpected, managedPresent,
            expectedFunctions, presentFunctions, missing,
            templatesPresent,
            complete: templatesPresent && managedComplete && functionsComplete
        }
    }

    const installedOf = (key) => {
        const s = currentStatus || {}
        if (key === 'ui') return uiIntegrity(s).complete
        if (key === 'datad') return s.INSTALLED_DATAD === 'yes'
        return s.INSTALLED_DEVUI === 'yes'
    }
    const remoteVerOf = (key) => (remoteVers[key] && remoteVers[key].version) || ''
    // 需要更新: 已装 + 远端有版本 + 与本地记录不一致 (本地未知也算需要, 用于同步)
    const needUpdate = (key) => installedOf(key) && !!remoteVerOf(key) && getVer(key) !== remoteVerOf(key)
    const allInstalled = () => COMP_KEYS.every(installedOf)

    // === 状态渲染 ===
    const renderState = (s) => {
        currentStatus = s
        const runningDevui = (parseInt(s.RUNNING_DEVUI, 10) || 0) > 0
        const runningDatad = (parseInt(s.RUNNING_DATAD, 10) || 0) > 0
        const integrity = uiIntegrity(s)
        const { uiCount, subpageCount, functionCount } = integrity

        const binCard = (key, running, installed, size) => {
            const local = getVer(key), remote = remoteVerOf(key)
            const upd = installed && remote && local !== remote
            let cls, icon, value
            const ver = local || (installed ? '(版本未知)' : '')
            if (running) { cls = upd ? 'warn' : 'ok'; icon = upd ? '🆕' : '✅'; value = '运行中' }
            else if (installed) { cls = 'warn'; icon = '⏸'; value = '未运行' }
            else { cls = 'bad'; icon = '❌'; value = '未安装' }
            const sub = installed ? `${ver}${ver ? ' · ' : ''}${fmtSize(size)}${upd ? ' → ' + remote : ''}` : '需安装'
            const c = COMP[key]
            return `<div class="u60_stat ${cls}"><div class="u60_stat_icon">${icon}</div><div class="u60_stat_value">${value}</div><div class="u60_stat_sub" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div><div class="u60_stat_label">${c.icon} ${c.label}</div></div>`
        }
        const uiCardHtml = () => {
            const local = getVer('ui'), remote = remoteVerOf('ui')
            const installed = integrity.templatesPresent
            const complete = integrity.complete
            const upd = installed && remote && local !== remote
            const cls = !installed || !complete ? 'bad' : (upd ? 'warn' : 'ok')
            const icon = !installed || !complete ? '❌' : (upd ? '🆕' : '✅')
            const functionSummary = integrity.expectedFunctions > 0
                ? `${integrity.presentFunctions}/${integrity.expectedFunctions} 功能`
                : `${functionCount} 功能`
            const value = installed ? `${uiCount} 页 / ${subpageCount} 二级 / ${functionSummary}` : '无模板'
            const ver = local || (installed ? '(版本未知)' : '')
            const missing = integrity.missing ? `缺失: ${integrity.missing}` : '受管理文件不完整'
            const sub = !installed ? '需推送 UI' : (!complete ? `${ver}${ver ? ' · ' : ''}${missing}，需重装 UI` : `${ver}${upd ? ' → ' + remote : ''}`)
            return `<div class="u60_stat ${cls}"><div class="u60_stat_icon">${icon}</div><div class="u60_stat_value">${value}</div><div class="u60_stat_sub" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div><div class="u60_stat_label">🎨 UI 界面</div></div>`
        }

        $state.innerHTML =
            binCard('datad', runningDatad, installedOf('datad'), s.SIZE_DATAD) +
            binCard('devui', runningDevui, installedOf('devui'), s.SIZE_DEVUI) +
            uiCardHtml()

        // 主按钮: 未全装→一键安装; 全装且有更新→一键更新全部; 否则→已最新(禁用)
        const updates = COMP_KEYS.filter(needUpdate)
        const binariesInstalled = installedOf('datad') && installedOf('devui')
        if (binariesInstalled && integrity.templatesPresent && !integrity.complete) {
            $btnInstall.textContent = '🧰 修复 UI 缺失文件'
            $btnInstall.dataset.mode = 'repairUi'
            $btnInstall.disabled = false
            $btnInstall.classList.add('u60_update'); $btnInstall.classList.remove('u60_primary')
        } else if (!allInstalled()) {
            $btnInstall.textContent = '⚡ 一键安装'
            $btnInstall.dataset.mode = 'install'
            $btnInstall.disabled = false
            $btnInstall.classList.add('u60_primary'); $btnInstall.classList.remove('u60_update')
        } else if (updates.length) {
            $btnInstall.textContent = `🔄 一键更新全部 (${updates.map(k => COMP[k].short).join('/')})`
            $btnInstall.dataset.mode = 'updateAll'
            $btnInstall.disabled = false
            $btnInstall.classList.add('u60_update'); $btnInstall.classList.remove('u60_primary')
        } else {
            $btnInstall.textContent = '✅ 全部已是最新'
            $btnInstall.dataset.mode = 'none'
            $btnInstall.disabled = true
            $btnInstall.classList.remove('u60_primary', 'u60_update')
        }

        // 单组件更新按钮 (仅对有更新的组件显示)
        const legacyWarn = s.LEGACY_RESIDUE === 'yes'
        const legacyWarnHtml = legacyWarn
            ? `<div style="font-size:11px;color:#f7c66b;line-height:1.45;padding:7px 9px;border:1px solid rgba(247,198,107,.35);border-radius:8px;background:rgba(247,198,107,.08);">⚠️ 检测到旧版残留，建议先清理后再安装/更新。</div>`
            : ''
        const updateButtonsHtml = updates.map(k =>
            `<button class="btn" data-comp="${k}">↻ 单独更新 ${COMP[k].label} (${getVer(k) || '?'} → ${remoteVerOf(k)})</button>`
        ).join('')
        const customForceKeys = usingCustomSrc() && getCustomUrl()
            ? COMP_KEYS.filter(k => installedOf(k) && !updates.includes(k))
            : []
        const customButtonsHtml = customForceKeys.map(k =>
            `<button class="btn" data-comp="${k}">↻ 自定义更新 ${COMP[k].label}（按目录自动识别）</button>`
        ).join('')
        $compUpdates.innerHTML = legacyWarnHtml + updateButtonsHtml + customButtonsHtml
        $compUpdates.querySelectorAll('button[data-comp]').forEach(b => {
            b.onclick = lock(async () => { await updateOne(b.dataset.comp) })
        })

        const $persist = $('#u60_persist')
        if ($persist) $persist.textContent = s.PERSIST === 'yes' ? '🚀 自启已开' : '💤 自启已关'
    }

    let refreshInFlight = null
    let refreshQueued = false
    let statusMutationSeq = 0
    const refresh = async (options) => {
        if (refreshInFlight) {
            refreshQueued = true
            return refreshInFlight
        }
        const mutationSeq = statusMutationSeq
        refreshInFlight = (async () => {
            const s = await queryStatus(options)
            if (mutationSeq === statusMutationSeq) renderState(s)
            else refreshQueued = true
            return s
        })()
        try { return await refreshInFlight }
        finally {
            refreshInFlight = null
            if (refreshQueued) {
                refreshQueued = false
                void refresh().catch(e => LOG('queued status refresh failed', e))
            }
        }
    }
    const refreshBestEffort = (options) => {
        void refresh(options).catch(e => LOG('background status refresh failed', e))
    }
    const patchCurrentStatus = (patch) => {
        if (!currentStatus) return
        statusMutationSeq++
        renderState({ ...currentStatus, ...patch })
        if (busy) document.querySelectorAll(`#${MODAL_ID} button`).forEach(b => { b.disabled = true })
    }
    const refreshVersions = async () => {
        const seq = ++versionFetchSeq
        const expectedSrc = getSrc()
        const expectedCustom = readCustomUrl()
        let next = remoteVers
        try { next = await fetchRemoteVersions() } catch (e) { LOG('fetch versions', e) }
        if (seq !== versionFetchSeq) return remoteVers
        if (expectedSrc !== getSrc()) return remoteVers
        if (expectedSrc === 'custom' && expectedCustom !== readCustomUrl()) return remoteVers
        remoteVers = next
        if (expectedSrc === 'custom' && expectedCustom && !remoteVers.datad && !remoteVers.devui && !remoteVers.ui) {
            toast('自定义源未找到可读的 version.json，无法自动判断更新；仍可用“自定义更新”按钮强制更新。', 'pink', 5000)
        }
        if (currentStatus) renderState(currentStatus)
        return remoteVers
    }

    // === 源选择器 ===
    const renderCustomSourceBox = () => {
        if (!$customBox || !$customUrl) return
        const isCustom = usingCustomSrc()
        $customBox.style.display = isCustom ? 'block' : 'none'
        if (isCustom) $customUrl.value = readCustomUrl()
    }
    const renderSrcOptions = () => {
        const cur = getSrc()
        $srcSel.innerHTML = ''
        Object.entries(SOURCES).forEach(([k, v]) => {
            const opt = document.createElement('option')
            opt.value = k; opt.textContent = v.label
            if (k === cur) opt.selected = true
            $srcSel.appendChild(opt)
        })
        renderCustomSourceBox()
    }
    $srcSel.onchange = async () => {
        const v = $srcSel.value
        if (v === 'netdisk' && !netdiskReady()) {
            toast('网盘地址尚未配置 (插件里 NETDISK_FILES)', 'red', 4000)
            $srcSel.value = getSrc()
            return
        }
        setSrc(v)
        resetCustomResolveCache()
        renderCustomSourceBox()
        if (v === 'custom') {
            toast('⚠️ 自定义链接文件安全不保证，请确认来源可信', 'pink', 5000)
            if (!getCustomUrl()) {
                try { $customUrl && $customUrl.focus() } catch (e) {}
                if (currentStatus) renderState(currentStatus)
                return
            }
        } else {
            toast(`更新源: ${SOURCES[v].label}`, 'green', 1500)
        }
        await refreshVersions()
    }
    if ($customUrl) {
        $customUrl.oninput = () => { setCustomUrl($customUrl.value); resetCustomResolveCache() }
        $customUrl.onchange = async () => {
            setCustomUrl($customUrl.value)
            resetCustomResolveCache()
            if (usingCustomSrc() && getCustomUrl()) {
                toast('自定义链接已保存。注意: 插件不保证自定义链接文件安全。', 'pink', 5000)
                await refreshVersions()
            }
        }
    }

    const lock = (fn) => async (event) => {
        if (busy) return
        busy = true
        const all = document.querySelectorAll(`#${MODAL_ID} button`)
        all.forEach(b => { b.disabled = true })
        try { await fn({ event, button: event && event.currentTarget }) }
        catch (e) {
            toast(String(e && e.message || e), 'red', 5000)
            LOG(e)
            refreshBestEffort()
        }
        finally { busy = false; all.forEach(b => { b.disabled = false }) }
    }

    const requireEnv = async () => {
        if (!(await isRoot())) throw new Error('需要 root 权限')
        const env = await checkEnv()
        if (env.UID !== '0') throw new Error('需要 root (UID != 0)')
        if (env.CURL !== 'yes') throw new Error('设备缺 curl, 无法下载')
        if (env.TAR !== 'yes') throw new Error('设备缺 tar, 无法解压 UI')
        if (env.ARCH !== 'aarch64') LOG(`⚠️ arch=${env.ARCH} 非 aarch64`)
        if (env.DRM !== 'yes') LOG('⚠️ /dev/dri/card0 不存在')
    }

    // === 首次安装确认写自启 ===
    const confirmBoot = () => new Promise((resolve) => {
        const id = 'u60_boot_confirm'
        const old = document.getElementById(id); if (old) old.remove()
        const mask = document.createElement('div')
        mask.className = 'mask'; mask.id = id
        mask.style.cssText = 'top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:100000;'
        mask.innerHTML = `
          <div class="modal" style="width:92%;max-width:410px;padding:18px;">
            <div class="title" style="margin-bottom:10px;"><span>✅ 安装完成，请先看屏幕</span></div>
            <div style="font-size:13px;line-height:1.75;">
                开源 UI 已尝试接管。<b>请现在抬头观察设备小屏：</b><br>
                • 屏幕<b style="color:#5fd07f">已正常显示新界面</b> → 点"屏幕正常，写入开机自启"。<br>
                • 屏幕<b style="color:tomato">黑屏 / 卡死</b> → 点"暂不写入"。<u>此时未改开机项，重启即恢复原厂。</u>
            </div>
            <div style="display:flex;gap:8px;margin-top:16px;">
                <button class="btn" id="${id}_no" style="flex:1;padding:10px;">暂不写入</button>
                <button class="btn" id="${id}_yes" style="flex:1.4;padding:10px;background:#1a7a3a;color:#fff;font-weight:600;">屏幕正常，写入开机自启</button>
            </div>
          </div>`
        document.body.appendChild(mask)
        const done = (v) => { try { mask.remove() } catch (e) {} ; resolve(v) }
        mask.querySelector(`#${id}_yes`).onclick = () => done(true)
        mask.querySelector(`#${id}_no`).onclick = () => done(false)
    })

    const confirmLegacyCleanup = (items) => new Promise((resolve) => {
        const id = 'u60_legacy_cleanup'
        const old = document.getElementById(id); if (old) old.remove()
        const lines = fmtLegacyItems(items)
        const listHtml = lines.length
            ? `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);font-size:11px;line-height:1.55;max-height:150px;overflow:auto;text-align:left;">${lines.map(x => `• ${escapeHtml(x)}`).join('<br>')}</div>`
            : ''
        const mask = document.createElement('div')
        mask.className = 'mask'; mask.id = id
        mask.style.cssText = 'top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:100000;'
        mask.innerHTML = `
          <div class="modal" style="width:92%;max-width:430px;padding:18px;">
            <div class="title" style="margin-bottom:10px;"><span>⚠️ 检测到旧版残留</span></div>
            <div style="font-size:13px;line-height:1.7;text-align:left;">
                检测到设备上还留着旧版本文件/自启残留。<br>
                现在先清理会更稳，能避免重复自启、旧二进制占空间或路径混用；旧 `/data/ui` 会先迁到新目录再删除，并写入新的 datad/devui 独立启动脚本。
            </div>
            ${listHtml}
            <div style="display:flex;gap:8px;margin-top:16px;">
                <button class="btn" id="${id}_keep" style="flex:1;padding:10px;">保留并继续</button>
                <button class="btn" id="${id}_clean" style="flex:1.3;padding:10px;background:#1a7a3a;color:#fff;font-weight:600;">清理后继续</button>
            </div>
          </div>`
        document.body.appendChild(mask)
        const done = (v) => { try { mask.remove() } catch (e) {} ; resolve(v) }
        mask.querySelector(`#${id}_clean`).onclick = () => done(true)
        mask.querySelector(`#${id}_keep`).onclick = () => done(false)
    })

    // === 全新安装 (三组件全下, 再接管, 失败回退) ===
    const doInstallAll = async () => {
        await requireEnv()
        ensureCustomSourceReady()
        if (usingCustomSrc()) toast('⚠️ 正在使用自定义链接，插件不保证自定义链接文件安全。', 'pink', 5000)
        const s0 = currentStatus || await queryStatus()
        const wasPersisted = s0.PERSIST === 'yes'
        if (!remoteVers.devui && !remoteVers.datad) await refreshVersions()
        openProgress('安装中 ...')
        try {
            updateProgress('安装中', '[1/4] 下载 datad ...')
            const datadNew = await downloadBinaryToNew('datad')
            updateProgress('安装中', '[2/4] 下载 devui ...')
            const devuiNew = await downloadBinaryToNew('devui')
            updateProgress('安装中', '[3/4] 下载并解压 UI ...')
            await installUiTemplates()
            updateProgress('安装中', '[4/4] 切换到开源 UI ...')
            await installSupportFiles()
            await sh(`mv -f ${datadNew} ${DATAD_BIN}; chmod 755 ${DATAD_BIN}; mv -f ${devuiNew} ${DEVUI_BIN}; chmod 755 ${DEVUI_BIN}; echo ok`, 8000)
            await startOurServices()
            if (!(await verifyRunning())) {
                updateProgress('安装失败, 回退中', '开源 UI 未启动, 恢复 ZTE 原厂 ...')
                await stopOurServices(); await restoreZte()
                throw new Error('开源 UI 启动失败, 已自动回退原厂, 屏幕应已恢复')
            }
            markInstalledVersion('datad')
            markInstalledVersion('devui')
            markInstalledVersion('ui')
            await refresh()
        } finally { closeProgress() }
        if (!wasPersisted) {
            if (await confirmBoot()) {
                await setBoot(true); await refresh()
                toast('🚀 开机自启已写入 /etc/rc.local', 'green', 5000)
            } else {
                toast('已安装但未设置开机自启; 重启会恢复原厂, 确认正常后点"切换自启"', '', 8000)
            }
        } else {
            toast('🎉 安装完成', 'green', 5000)
        }
    }

    // === 单组件更新 ===
    // === Local installation ===============================================
    const doLocalInstall = async () => {
        if (!(await isRoot())) throw new Error('\u9700\u8981 root \u6743\u9650')
        const env = await checkEnv()
        if (env.UID !== '0') throw new Error('\u9700\u8981 root \u6743\u9650 (UID != 0)')
        const files = localFilesUnique()
        if (!files.length) throw new Error('\u8BF7\u5148\u9009\u62E9 release \u6587\u4EF6\u6216\u6E90\u7801 ui \u6587\u4EF6\u5939')
        const found = classifyLocalFiles(files)
        if (!found.uiArchive && !found.devui && !found.datad && !found.uiSource.length) {
            throw new Error('\u672A\u8BC6\u522B\u5230 ui.tar.gz\u3001u60pro-devui-aarch64\u3001zwrt-datad-aarch64 \u6216 UI \u6E90\u7801\u6587\u4EF6')
        }
        const needsUiUpload = !!(found.uiArchive || found.uiSource.length)
        if (needsUiUpload) {
            if (env.TAR !== 'yes') throw new Error('\u8DEF\u7531\u5668\u7F3A\u5C11 tar \u547D\u4EE4\uFF0C\u65E0\u6CD5\u5B89\u88C5 UI')
            const b64 = await sh('command -v base64 >/dev/null 2>&1 && echo yes || echo no', 5000)
            if (!b64.success || !/yes/.test(b64.content || '')) throw new Error('\u8DEF\u7531\u5668\u7F3A\u5C11 base64 \u547D\u4EF6\uFF0C\u65E0\u6CD5\u4E0A\u4F20\u6587\u4EF6')
        }
        const localVersion = found.version ? await localVersionFromFile(found.version) : null
        openProgress('\u672C\u5730\u5B89\u88C5 ...')
        try {
            let hasUi = false
            let hasBinary = false
            if (found.version) await localUploadFile(found.version, LOCAL_VERSION_FILE, 'version.json')
            if (found.devui) {
                await localUploadFile(found.devui, `${DEVUI_BIN}.new`, 'u60pro-devui')
                hasBinary = true
            }
            if (found.datad) {
                await localUploadFile(found.datad, `${DATAD_BIN}.new`, 'zwrt-datad')
                hasBinary = true
            }
            if (found.uiArchive) {
                await localUploadFile(found.uiArchive, TMP_TGZ, 'ui.tar.gz')
                hasUi = true
            } else if (found.uiSource.length) {
                hasUi = await buildLocalUiArchive(found.uiSource)
            }
            if (hasUi && localVersion && localVersion.ui && localVersion.ui.requiredRendererMarker) {
                const marker = String(localVersion.ui.requiredRendererMarker)
                if (!/^[A-Z0-9_]{1,64}$/.test(marker)) throw new Error('UI 版本信息中的程序标记无效')
                const target = found.devui ? DEVUI_BIN + '.new' : DEVUI_BIN
                const compatible = await sh(`LC_ALL=C grep -q ${shellQuote(marker)} ${shellQuote(target)} && echo U60_RENDERER_COMPATIBLE`, 8000)
                if (!compatible.success || !/(?:^|\s)U60_RENDERER_COMPATIBLE(?:\s|$)/.test(compatible.content || '')) {
                    throw new Error('这份 UI 需要配套新版屏幕程序。请同时选择 u60pro-devui-aarch64、ui.tar.gz 和 version.json 后重新上传。')
                }
            }
            if (hasUi) {
                updateProgress('\u672C\u5730 UI', '\u6B63\u5728\u6821\u9A8C\u5E76\u5B89\u88C5 UI \u6A21\u677F ...')
                await installUiTemplates({ existing: true })
            }
            if (hasBinary) {
                updateProgress('\u672C\u5730\u4E8C\u8FDB\u5236', '\u6B63\u5728\u66FF\u6362\u7A0B\u5E8F\u5E76\u91CD\u542F\u670D\u52A1 ...')
                await installSupportFiles()
                const moves = []
                if (found.datad) moves.push(`mv -f ${shellQuote(DATAD_BIN + '.new')} ${shellQuote(DATAD_BIN)} && chmod 755 ${shellQuote(DATAD_BIN)}`)
                if (found.devui) moves.push(`mv -f ${shellQuote(DEVUI_BIN + '.new')} ${shellQuote(DEVUI_BIN)} && chmod 755 ${shellQuote(DEVUI_BIN)}`)
                const serviceOptions = { datad: !!found.datad, devui: !!found.devui }
                const kills = []
                if (found.devui) kills.push(`killall -9 ${DEVUI_PROC} 2>/dev/null || true`)
                if (found.datad) kills.push(`killall -9 ${DATAD_PROC} 2>/dev/null || true`, `killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null || true`)
                const moved = await sh(`${kills.join('; ')}; sleep 0.3; ${moves.join(' && ')} && echo ok`, 15000)
                if (!moved.success || !/ok/.test(moved.content || '')) throw new Error(`\u66FF\u6362\u4E8C\u8FDB\u5236\u5931\u8D25: ${moved.content || '(empty)'}`)
                await startOurServices(serviceOptions)
                if (!(await verifyRunning(serviceOptions))) {
                    await stopOurServices(serviceOptions); await restoreZte()
                    throw new Error('\u4E8C\u8FDB\u5236\u5DF2\u5B89\u88C5\uFF0C\u4F46\u670D\u52A1\u542F\u52A8\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u539F\u5382')
                }
            }
            if (localVersion) {
                const setLocal = (key) => {
                    const item = localVersion[key]
                    if (item && item.version) setVer(key, item.version)
                }
                if (found.devui) setLocal('devui')
                if (hasUi) setLocal('ui')
                if (found.datad) setLocal('datad')
            }
            await refresh()
            toast(`\u672C\u5730\u5B89\u88C5\u5B8C\u6210${hasUi ? '\uFF08UI\uFF09' : ''}${hasBinary ? '\uFF08\u4E8C\u8FDB\u5236\uFF09' : ''}`, 'green', 5000)
        } finally { closeProgress() }
    }

    if ($localUpload) {
        $localUpload.onclick = lock(async ({ button }) => {
            const original = button ? button.textContent : '\u4E0A\u4F20\u5E76\u5B89\u88C5'
            if (button) button.textContent = '\u5B89\u88C5\u4E2D\u2026'
            try { await doLocalInstall() }
            finally { if (button) button.textContent = original }
        })
    }

    const updateOne = async (key) => {
        await requireEnv()
        ensureCustomSourceReady()
        if (usingCustomSrc()) toast('⚠️ 正在使用自定义链接，插件不保证自定义链接文件安全。', 'pink', 5000)
        if (!remoteVerOf(key)) await refreshVersions()
        const rv = remoteVerOf(key)
        openProgress(`更新 ${COMP[key].label} ...`)
        const serviceOptions = key === 'datad' ? { datad: true, devui: false } : { datad: false, devui: true }
        try {
            if (key === 'ui') {
                await installUiTemplates()
            } else if (key === 'datad') {
                const nw = await downloadBinaryToNew('datad')
                await installSupportFiles()
                await sh(`killall -9 ${DATAD_PROC} 2>/dev/null; killall -9 ${LEGACY_DATAD_PROC} 2>/dev/null; sleep 0.4; mv -f ${nw} ${DATAD_BIN}; chmod 755 ${DATAD_BIN}; echo ok`, 12000)
                await startOurServices(serviceOptions)
            } else { // devui
                const nw = await downloadBinaryToNew('devui')
                await installSupportFiles()
                await sh(`killall -9 ${DEVUI_PROC} 2>/dev/null; sleep 0.4; mv -f ${nw} ${DEVUI_BIN}; chmod 755 ${DEVUI_BIN}; echo ok`, 12000)
                await startOurServices(serviceOptions)
            }
            if (key !== 'ui' && !(await verifyRunning(serviceOptions))) {
                await stopOurServices(serviceOptions); await restoreZte()
                throw new Error(`${COMP[key].label} 更新后启动失败, 已回退原厂`)
            }
            markInstalledVersion(key)
            await refresh()
            toast(`${COMP[key].label} 已更新到 ${rv || (usingCustomSrc() ? 'custom' : '最新')}`, 'green', 4000)
        } finally { closeProgress() }
    }

    const updateAll = async () => {
        const updates = COMP_KEYS.filter(needUpdate)
        if (!updates.length) { toast('已是最新', '', 2000); return }
        for (const k of updates) await updateOne(k)
        toast(`🔄 已更新: ${updates.map(k => COMP[k].short).join(' / ')}`, 'green', 5000)
    }

    // === 主按钮 ===
    $btnInstall.onclick = lock(async () => {
        const mode = $btnInstall.dataset.mode || 'install'
        if (mode === 'install') await doInstallAll()
        else if (mode === 'updateAll') await updateAll()
        else if (mode === 'repairUi') await updateOne('ui')
    })

    // === 服务控制按钮 ===
    $('#u60_start').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '启动'
        if (button) button.textContent = '启动中…'
        toast('正在启动 DevUI…', '', 2200)
        try {
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await startOurServices()
            if (!(await verifyRunning())) {
                await stopOurServices(); await restoreZte()
                throw new Error('启动失败, 已回退原厂')
            }
            patchCurrentStatus({ RUNNING_DEVUI: '1', RUNNING_DATAD: '1' })
            if (button) button.textContent = original
            toast('已启动', 'green', 2500)
            refreshBestEffort()
        } finally {
            if (button && button.textContent === '启动中…') button.textContent = original
        }
    })
    $('#u60_stop').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '停止'
        if (button) button.textContent = '停止中…'
        toast('正在停止 DevUI…', '', 2200)
        try {
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await stopOurServices()
            patchCurrentStatus({ RUNNING_DEVUI: '0', RUNNING_DATAD: '0' })
            if (button) button.textContent = original
            toast('已停止', 'green', 2500)
            refreshBestEffort()
        } finally {
            if (button && button.textContent === '停止中…') button.textContent = original
        }
    })
    $('#u60_restart').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '重启'
        if (button) button.textContent = '重启中…'
        toast('正在重启 DevUI…', '', 2200)
        try {
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await stopOurServices(); await wait(500); await startOurServices()
            patchCurrentStatus({ RUNNING_DEVUI: '1', RUNNING_DATAD: '1' })
            if (button) button.textContent = original
            toast('已重启', 'green', 2500)
            refreshBestEffort()
        } finally {
            if (button && button.textContent === '重启中…') button.textContent = original
        }
    })
    $('#u60_persist').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '切换自启'
        let completed = false
        try {
            let s = currentStatus
            if (!s) {
                if (button) button.textContent = '正在读取自启状态…'
                toast('正在读取开机自启状态…', '', 1800)
                s = await queryStatus()
                if (!currentStatus) currentStatus = s
            }
            const enable = s.PERSIST !== 'yes'
            if (button) button.textContent = enable ? '正在开启自启…' : '正在关闭自启…'
            toast(enable ? '正在开启开机自启…' : '正在关闭开机自启…', '', 2200)
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await setBoot(enable)
            completed = true
            patchCurrentStatus({ PERSIST: enable ? 'yes' : 'no' })
            toast(enable ? '开机自启已开启' : '开机自启已关闭', 'green', 3000)
            refreshBestEffort()
        } finally {
            if (!completed && button) button.textContent = original
        }
    })
    $('#u60_refresh').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '刷新'
        if (button) button.textContent = '刷新中…'
        toast('正在刷新状态…', '', 1800)
        try {
            await refresh(); await refreshVersions()
            toast('已刷新', 'green', 1500)
        } finally {
            if (button) button.textContent = original
        }
    })
    $('#u60_reinstall_ui').onclick = lock(async () => { await updateOne('ui') })
    $('#u60_diagnostic').onclick = lock(async ({ button }) => {
        const original = button ? button.textContent : '插件诊断'
        if (button) button.textContent = '诊断中…'
        toast('正在收集插件诊断…', '', 1800)
        try {
            const report = await collectDiagnostic()
            showDiagnosticModal(report)
        } finally {
            if (button) button.textContent = original
        }
    })

    // === 还原原厂 (双击确认) ===
    let restoreCt = 0, restoreTimer = null
    const $restore = $('#u60_restore')
    const resetRestoreConfirm = () => {
        restoreCt = 0
        clearTimeout(restoreTimer); restoreTimer = null
        if ($restore) $restore.textContent = '还原 ZTE 原厂'
    }
    const runRestore = lock(async ({ button }) => {
        if (button) button.textContent = '正在还原原厂…'
        toast('正在还原 ZTE 原厂…', '', 2500)
        try {
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await stopOurServices(); await restoreZte()
            patchCurrentStatus({ RUNNING_DEVUI: '0', RUNNING_DATAD: '0' })
            if (button) button.textContent = '还原 ZTE 原厂'
            toast('ZTE 原厂已恢复, 插件文件保留', 'green', 3500)
            refreshBestEffort()
        } finally {
            if (button && button.textContent === '正在还原原厂…') button.textContent = '还原 ZTE 原厂'
        }
    })
    $restore.onclick = (event) => {
        if (busy) return
        if (++restoreCt < 2) {
            $restore.textContent = '再次点击确认还原'
            toast('再点 1 次确认还原 ZTE 原厂', 'pink', 3000)
            clearTimeout(restoreTimer)
            restoreTimer = setTimeout(resetRestoreConfirm, 3000)
            return
        }
        restoreCt = 0
        clearTimeout(restoreTimer); restoreTimer = null
        void runRestore(event)
    }

    // === 彻底卸载 (连点 3 次; 清二进制 + rc.local + /data/plugins + /data/u60pro + 旧 /data/ui) ===
    let uninstallCt = 0, uninstallTimer = null
    const $uninstall = $('#u60_uninstall')
    const resetUninstallConfirm = () => {
        uninstallCt = 0
        clearTimeout(uninstallTimer); uninstallTimer = null
        if ($uninstall) $uninstall.textContent = '彻底卸载'
    }
    const runUninstall = lock(async ({ button }) => {
        if (button) button.textContent = '正在彻底卸载…'
        toast('正在彻底卸载并恢复原厂…', '', 3000)
        try {
            if (!(await isRoot())) throw new Error('需要 root 权限')
            await fullUninstall()
            clearVers()
            pluginDirsReady = false
            patchCurrentStatus({
                INSTALLED_DEVUI: 'no', INSTALLED_DATAD: 'no',
                SIZE_DEVUI: '0', SIZE_DATAD: '0', UI_FILES: '0', SUBPAGE_FILES: '0',
                RUNNING_DEVUI: '0', RUNNING_DATAD: '0', PERSIST: 'no',
                LEGACY_RESIDUE: 'no', LEGACY_ITEMS: ''
            })
            if (button) button.textContent = '彻底卸载'
            toast('已彻底卸载 (含 /data/plugins 与旧 /data/ui), 已恢复原厂', 'green', 4000)
            refreshBestEffort({ ensureDirs: false })
        } finally {
            if (button && button.textContent === '正在彻底卸载…') button.textContent = '彻底卸载'
        }
    })
    $uninstall.onclick = (event) => {
        if (busy) return
        uninstallCt++
        if (uninstallCt < 3) {
            const left = 3 - uninstallCt
            $uninstall.textContent = `再点 ${left} 次彻底卸载`
            toast(`再点 ${left} 次彻底卸载 (清二进制+自启+/data/plugins+/data/u60pro+旧 /data/ui)`, 'pink', 3200)
            clearTimeout(uninstallTimer)
            uninstallTimer = setTimeout(resetUninstallConfirm, 3500)
            return
        }
        uninstallCt = 0
        clearTimeout(uninstallTimer); uninstallTimer = null
        void runUninstall(event)
    }

    // === 入口按钮 ===
    openHandler = async () => {
        showModal(`#${MODAL_ID}`)
        renderSrcOptions()
        try {
            await refresh()
            if (currentStatus && currentStatus.LEGACY_RESIDUE === 'yes') {
                if (await confirmLegacyCleanup(currentStatus.LEGACY_ITEMS)) {
                    await cleanupLegacyResidue()
                    await refresh()
                    toast('已清理旧版残留', 'green', 3000)
                } else {
                    toast('已保留旧版残留，可继续使用；重新打开插件时会再次提示', '', 4500)
                }
            }
            if (readStoredSrc()) await refreshVersions()
            const updates = COMP_KEYS.filter(needUpdate)
            if (updates.length) toast(`有更新: ${updates.map(k => COMP[k].short).join(' / ')}`, 'green', 5000)
        } catch (e) { LOG('open init', e) }
    }

    LOG('loaded')
    } catch (e) {
        const msg = String(e && e.message || e)
        LOG('boot error', e)
        openHandler = async () => bootToast(`屏幕管理插件加载异常: ${msg}`, 'red', 7000)
        try { await mountOpenButton() }
        catch (ee) { await showBootFallback(msg) }
    }
})()
//</script >
