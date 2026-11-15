/**
 * Explainable scoring engine.
 *
 * Model shape: a set of rules, each producing at most one hit with a point
 * weight and a human-readable evidence string. Hits are grouped into
 * families; each family has a cap so no single noisy group can dominate, and
 * the family subtotals are the explanation shown to analysts. The final score
 * is a saturating combination, not a plain sum, so a browser that trips one
 * strong tell is flagged without requiring several weak ones to pile up.
 *
 * Weights come from measurements, not intuition: every rule below was checked
 * against real Chrome, Playwright headless-shell, Playwright's newer headless
 * mode, a stealth-patched build, and OS-level synthetic input. See
 * data/calibration.json for the observed values that set each threshold.
 */

import type { FeaturePacket, SignalHit, ScoreResult, FamilyId } from '../../shared/types.ts';

interface Ctx {
  p: FeaturePacket;
  e: FeaturePacket['env'];
  b: FeaturePacket['behavior'];
}

type Rule = (c: Ctx) => SignalHit | null;

const hit = (id: string, label: string, family: FamilyId, points: number, evidence: string): SignalHit =>
  ({ id, label, family, points, evidence });

/** A hit that is a contradiction or physical impossibility, not a tendency.
 *  These do not depend on statistics and are not weakened by sample size. */
const fact = (id: string, label: string, family: FamilyId, points: number, evidence: string): SignalHit =>
  ({ id, label, family, points, evidence, certain: true });

const FAMILIES: { id: FamilyId; name: string; cap: number }[] = [
  { id: 'automation', name: '自动化框架痕迹', cap: 100 },
  { id: 'contradiction', name: '环境信号自相矛盾', cap: 100 },
  { id: 'integrity', name: '运行时完整性', cap: 60 },
  { id: 'mouse', name: '鼠标轨迹', cap: 80 },
  { id: 'keyboard', name: '键盘节奏', cap: 70 },
  { id: 'touch', name: '触摸行为', cap: 50 },
];

const pct = (v: number | null | undefined) => (v == null ? 'n/a' : (v * 100).toFixed(1) + '%');
const num = (v: number | null | undefined, d = 1) => (v == null ? 'n/a' : Number(v).toFixed(d));

// ---------------------------------------------------------------- helpers
const uaIsMobile = (ua: string) => /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
const uaIsIOS = (ua: string) => /iPhone|iPad|iPod/i.test(ua);
const uaIsAndroid = (ua: string) => /Android/i.test(ua);
const uaIsChrome = (ua: string) => /Chrome\//.test(ua) && !/OPR\/|Edg\//.test(ua);
const brandList = (e: FeaturePacket['env']) => (e.uaBrands || []).map((b: any) => String(b)).join(' ');

// ---------------------------------------------------------------- automation
const RULES: Rule[] = [
  // --- explicit automation markers -------------------------------------
  c => {
    const ua = c.e.ua || '';
    const brands = brandList(c.e);
    if (/HeadlessChrome/.test(ua) || /HeadlessChrome/.test(brands)) {
      return fact('auto.headless-ua', 'UA/Client Hints 直接暴露 HeadlessChrome', 'automation', 90, `userAgent 或 brand 列表含 "HeadlessChrome"`);
    }
    return null;
  },
  c => {
    if (/Chrome\/(\d+)/.test(c.e.ua || '') && /HeadlessChrome/.test(c.e.ua || '') === false && c.e.uaBrands?.length) {
      const hasChromeBrand = c.e.uaBrands.some((b: string) => /Google Chrome/.test(b));
      const hasChromiumBrand = c.e.uaBrands.some((b: string) => /Chromium/.test(b));
      if (!hasChromeBrand && !hasChromiumBrand) {
        return hit('auto.brand-mismatch', 'UA 声称 Chrome 但 Client Hints 无对应品牌', 'automation', 45, `brands=[${brandList(c.e)}] 与 UA 的 Chrome 版本不一致`);
      }
    }
    return null;
  },
  c => {
    const g = c.e.suspiciousGlobals || [];
    if (g.length) return fact('auto.globals', '检测到自动化框架全局变量', 'automation', 80, `命中: ${g.slice(0, 4).join(', ')}`);
    return null;
  },
  c => {
    if (c.e.webdriver === true) {
      return fact('auto.webdriver', 'navigator.webdriver 为 true', 'automation', 55, '浏览器声明自身处于自动化控制下');
    }
    return null;
  },
  c => {
    // Frame-level mismatch: an init script that only patched the top window
    // leaves a fresh iframe reporting the truth.
    if (c.e.webdriver === false && c.e.iframeWebdriver === true) {
      return fact('auto.webdriver-iframe', '主窗口与 iframe 的 webdriver 标记不一致', 'automation', 60, '主窗口 false，新建 iframe true → 主窗口被改写');
    }
    return null;
  },
  c => {
    // The canonical stealth paradox: deleting webdriver creates an own
    // property on window.navigator, where native browsers have none.
    const own = c.e.navOwnTampered || [];
    if (own.includes('webdriver') && c.e.webdriver !== true) {
      return fact('auto.webdriver-deleted', 'navigator.webdriver 被脚本删除', 'automation', 65, 'navigator 上出现自有属性 webdriver（原生实现位于原型链）');
    }
    return null;
  },
  c => {
    const own = (c.e.navOwnTampered || []).filter((k: string) => k !== 'webdriver');
    if (own.length) {
      return fact('auto.nav-tampered', 'navigator 属性被逐项覆写', 'automation', Math.min(60, 20 * own.length), `自有属性: ${own.slice(0, 6).join(', ')}`);
    }
    return null;
  },
  c => {
    const nn = c.e.navNonNative || [];
    if (nn.length) return fact('auto.non-native', 'navigator getter 非原生实现', 'integrity', 55, `非原生 getter: ${nn.slice(0, 6).join(', ')}`);
    return null;
  },
  c => {
    if (c.e.permissionsQueryTampered === true) return fact('auto.permissions-patched', 'Permissions.query 被替换', 'integrity', 45, 'Function.prototype.toString 不再返回 native code');
    return null;
  },
  c => {
    if (c.e.funcToStringTampered === true) return fact('auto.tostring-patched', 'Function.prototype.toString 被改写', 'integrity', 50, 'setTimeout 的 toString 已失去 native 标记');
    return null;
  },

  // --- headless rendering / capability stack ---------------------------
  c => {
    const plugins = c.e.pluginsN ?? 0;
    const pdf = c.e.pdfViewerEnabled;
    const chrome = c.e.chromeKeys;
    if (plugins === 0 && pdf === false && chrome === null) {
      return fact('auto.headless-shell', 'PDF 插件栈完全缺失（headless shell 特征）', 'automation', 60, 'plugins=0、pdfViewerEnabled=false、window.chrome 不存在');
    }
    return null;
  },
  c => {
    if (c.e.pluginsN === 0 && uaIsChrome(c.e.ua || '')) {
      return fact('auto.no-plugins', 'Chrome 内核但插件列表为空', 'automation', 30, `plugins=${c.e.pluginsN}, mimeTypes=${c.e.mimeN}`);
    }
    return null;
  },
  c => {
    const gl = (c.e.glRenderer || '') + ' ' + (c.e.glVendor || '');
    if (/SwiftShader|llvmpipe|Software Rasterizer|Mesa OffScreen/i.test(gl)) {
      return fact('auto.software-gl', 'WebGL 使用软件渲染器', 'automation', 35, `renderer=${String(c.e.glRenderer).slice(0, 90)}`);
    }
    return null;
  },
  c => {
    const missing = c.e.chromeKeys === null;
    if (missing && uaIsChrome(c.e.ua || '')) {
      return fact('auto.no-chrome-object', 'window.chrome 缺失', 'automation', 25, 'Chrome 家族 UA 下 window.chrome 必须存在');
    }
    return null;
  },
  c => {
    if (c.e.outerW === 0 || c.e.outerH === 0) {
      return fact('auto.zero-outer', '窗口外框尺寸为 0', 'automation', 40, `outerWidth=${c.e.outerW}, outerHeight=${c.e.outerH}`);
    }
    return null;
  },
  c => {
    // A real chrome window always has a title bar / toolbar, so the outer
    // box is taller than the viewport. Only full-screen or headless collapses
    // them to the same number.
    const oh = c.e.outerH || 0, ih = c.e.innerH || 0;
    const ow = c.e.outerW || 0, iw = c.e.innerW || 0;
    if (oh > 0 && oh === ih && ow > 0 && ow === iw && c.e.screenH === ih && c.e.screenW === iw) {
      return fact('auto.no-chrome-frame', '视口与外框/屏幕完全一致（无浏览器边框）', 'automation', 30, `inner=${iw}x${ih} outer=${ow}x${oh} screen=${c.e.screenW}x${c.e.screenH}`);
    }
    return null;
  },
  c => {
    const perm = c.e.notifPermission;
    if (perm === 'denied' && c.e.webdriver !== false) {
      return hit('auto.notif-denied', '通知权限在无交互时已被拒绝', 'automation', 20, 'Chrome 默认状态应为 "default"/"prompt"');
    }
    return null;
  },
  c => {
    // Mobile emulation still paints a desktop layout until the page sets a
    // viewport meta; a real phone never reports a layout wider than its screen.
    const iw = c.e.innerW || 0, sw = c.e.screenW || 1;
    if (uaIsMobile(c.e.ua || '') && iw > sw * 1.3) {
      return fact('contra.layout-wider-than-screen', '移动 UA 但布局宽度超过屏幕', 'contradiction', 55, `innerWidth=${iw} > screen.width=${sw}`);
    }
    return null;
  },

  // --- contradictions (the core ask) -----------------------------------
  c => {
    const mobileUa = uaIsMobile(c.e.ua || '');
    const touch = c.e.maxTouchPoints ?? 0;
    if (mobileUa && touch === 0) {
      return fact('contra.mobile-no-touch', 'UA 声明移动设备但没有触摸点', 'contradiction', 60, `UA 为移动端，maxTouchPoints=0`);
    }
    return null;
  },
  c => {
    const mobileUa = uaIsMobile(c.e.ua || '');
    if (mobileUa && c.e.pointerFine === true) {
      return fact('contra.mobile-fine-pointer', '移动 UA 但主指针为精确指针', 'contradiction', 45, 'matchMedia("(pointer:fine)") = true，移动设备应为 coarse');
    }
    return null;
  },
  c => {
    // iOS Safari has no navigator.userAgentData at all. Any iOS UA paired
    // with client hints means a non-Safari engine spoofing the UA string.
    if (uaIsIOS(c.e.ua || '') && c.e.hasUAData === true) {
      return fact('contra.ios-with-client-hints', 'iOS UA 却支持 Client Hints', 'contradiction', 60, 'Safari/WebKit 不实现 navigator.userAgentData');
    }
    return null;
  },
  c => {
    if (uaIsIOS(c.e.ua || '') && c.e.platform === 'MacIntel' && c.e.hasUAData === true) {
      return fact('contra.ios-platform', 'iOS UA 但平台标识为 MacIntel', 'contradiction', 35, '真实 iOS 上报 iPhone/iPad');
    }
    return null;
  },
  c => {
    const m = c.e.uaMobile;
    if (m === true && uaIsAndroid(c.e.ua || '') === false && uaIsIOS(c.e.ua || '') === false) {
      return fact('contra.hint-mobile-ua-desktop', 'Client Hints 声明移动端但 UA 不是', 'contradiction', 40, `uaMobile=true，UA=${String(c.e.ua).slice(0, 60)}`);
    }
    return null;
  },
  c => {
    // Emulation sets a phone-shaped screen with dpr=1 only when the attacker
    // changes the UA by hand and forgets the rest of the device profile.
    if (uaIsMobile(c.e.ua || '') && (c.e.dpr ?? 1) <= 1) {
      return hit('contra.mobile-dpr1', '移动 UA 但像素比为 1', 'contradiction', 25, `devicePixelRatio=${c.e.dpr}，现代手机 ≥2`);
    }
    return null;
  },
  c => {
    // Phone aspect ratio with a desktop UA is a common manual UA-swap mistake.
    const sw = c.e.screenW || 1, sh = c.e.screenH || 1;
    if (!uaIsMobile(c.e.ua || '') && sh / sw > 1.7 && sh > 600) {
      return hit('contra.portrait-desktop-ua', '竖屏手机尺寸却宣称桌面 UA', 'contradiction', 30, `screen=${sw}x${sh} 且 UA 非移动端`);
    }
    return null;
  },
  c => {
    const names = c.e.pluginNames || [];
    if (names.length > 0 && c.e.pdfViewerEnabled === false) {
      return fact('contra.plugins-vs-pdf', '插件列表与 PDF 能力互相矛盾', 'contradiction', 45, `pluginNames=${names.slice(0, 3).join(',')} 但 pdfViewerEnabled=false`);
    }
    return null;
  },
  c => {
    const perm = c.e.notifPermission;
    if (perm === 'denied' && c.e.webdriver === undefined) {
      return hit('contra.notif-denied', '通知权限状态异常', 'contradiction', 15, '无交互即 denied');
    }
    return null;
  },
  c => {
    if ((c.e.availH ?? 0) > (c.e.screenH ?? 0) + 1 || (c.e.availW ?? 0) > (c.e.screenW ?? 0) + 1) {
      return fact('contra.avail-gt-screen', '可用屏幕区域大于屏幕本身', 'contradiction', 35, `avail=${c.e.availW}x${c.e.availH} screen=${c.e.screenW}x${c.e.screenH}`);
    }
    return null;
  },
  c => {
    const p = c.e.platform || '';
    if (uaIsAndroid(c.e.ua || '') && p === 'MacIntel') {
      return fact('contra.android-mac-platform', 'Android UA 但平台标识为 MacIntel', 'contradiction', 30, 'Android 应上报 Linux armv8l / Android');
    }
    return null;
  },
  c => {
    // A UA that claims Edge/Firefox but ships a plain Chromium brand set.
    const ua = c.e.ua || '';
    const brands = brandList(c.e);
    if (/Edg\//.test(ua) && !/Microsoft Edge/.test(brands)) {
      return fact('contra.edge-brand', 'Edge UA 但品牌列表缺少 Microsoft Edge', 'contradiction', 35, `brands=[${brands}]`);
    }
    if (/Firefox\//.test(ua) && c.e.hasUAData === true) {
      return fact('contra.firefox-hints', 'Firefox UA 却支持 Client Hints', 'contradiction', 45, 'Firefox 未实现 navigator.userAgentData');
    }
    return null;
  },
  c => {
    if (c.e.webdriverDesc === 'absent') {
      return fact('contra.webdriver-absent', 'webdriver 属性从原型链消失', 'contradiction', 30, '标准 Chromium 中该属性应存在于 Navigator.prototype');
    }
    return null;
  },
  c => {
    const langs = c.e.languages || [];
    if (!langs.length || (langs.length === 1 && !langs[0])) {
      return hit('contra.no-languages', '语言列表为空', 'contradiction', 15, 'navigator.languages 为空');
    }
    return null;
  },
  c => {
    const cm = c.e.canvasMetrics;
    if (cm && cm.serif != null && cm.sans != null && Math.abs(cm.serif - cm.sans) < 0.01) {
      return fact('contra.font-stack-collapsed', 'serif 与 sans-serif 度量完全相同', 'contradiction', 30, `serif=sans=${num(cm.serif, 2)} → 字体栈缺失`);
    }
    return null;
  },
  c => {
    const cm = c.e.canvasMetrics;
    if (cm && cm.emoji != null && cm.emoji <= 0.01) {
      return hit('contra.no-emoji-font', '无表情字体（emoji 宽度为 0）', 'contradiction', 20, '常见于最小化容器镜像');
    }
    return null;
  },
  c => {
    const hc = c.e.hardwareConcurrency;
    if (hc === 0) return hit('contra.zero-cores', 'CPU 核数为 0', 'contradiction', 20, 'hardwareConcurrency=0');
    return null;
  },
  c => {
    const rtt = c.e.connection?.rtt;
    const dl = c.e.connection?.dl;
    if (rtt === 0 && dl === 10) {
      return hit('contra.net-defaults', '网络信息为 CDP 默认值', 'contradiction', 15, 'rtt=0 且 downlink=10 是 DevTools 协议的初始值');
    }
    return null;
  },

  // --- mouse trajectory -------------------------------------------------
  c => {
    // Synthetic dispatch teleports: it reports where the OS cursor happened
    // to be, then jumps to the scripted coordinate with no intermediate
    // samples. A fast physical flick stays below ~15,000 px/s; the threshold
    // here is 20,000 px/s over at least 60px.
    const m = c.b.mouse as any;
    if (m.teleportations > 0) {
      return hit('mouse.teleport', '指针位置发生非物理跳变', 'mouse', 45,
        `${m.teleportations} 次跳变，最大 ${m.teleportMaxPx}px（速度超过 20,000px/s）`);
    }
    return null;
  },
  c => {
    const m = c.b.mouse;
    if (m.moveCount < 2 && c.b.clicks > 0) {
      return hit('mouse.no-movement', '零轨迹点击', 'mouse', 70, `clicks=${c.b.clicks} 但 mouseX 采样点=${m.moveCount}`);
    }
    return null;
  },
  c => {
    const m = c.b.mouse;
    if (m.moveCount >= 8 && m.straightness != null && m.straightness > 0.999) {
      return hit('mouse.perfect-straight', '轨迹为数学直线', 'mouse', 55, `straightness=${num(m.straightness, 5)}（起终点位移/路径长度）`);
    }
    return null;
  },
  c => {
    const m = c.b.mouse;
    if (m.moveCount >= 6 && m.segCV != null && m.segCV < 0.02) {
      return hit('mouse.equal-segments', '每段位移长度几乎相同', 'mouse', 45, `段长变异系数 CV=${num(m.segCV, 4)}`);
    }
    return null;
  },
  c => {
    const m = c.b.mouse;
    if (m.moveCount >= 8 && m.dirRate != null && m.dirRate < 0.02) {
      return hit('mouse.no-curvature', '全程无方向修正', 'mouse', 40, `方向变化率=${pct(m.dirRate)}，人类轨迹持续微调`);
    }
    return null;
  },
  // Note: an "all coordinates are integers" rule was measured and removed.
  // Real OS pointer input on macOS delivers integer client coordinates (the
  // cursor position is quantised to points), so that feature fires on genuine
  // users and carries no discrimination. Kept documented so it is not
  // re-introduced.
  c => {
    const m = c.b.mouse;
    if (m.dtCV != null && m.moveCount >= 6 && m.dtCV < 0.05) {
      return hit('mouse.metronome', '移动事件间隔恒定', 'mouse', 45, `时间间隔 CV=${num(m.dtCV, 4)}`);
    }
    return null;
  },
  c => {
    const m = c.b.mouse;
    if (m.zeroDt != null && m.moveCount >= 6 && m.zeroDt > 0.4) {
      return hit('mouse.same-timestamp', '多个移动事件共享时间戳', 'mouse', 40, `同一时间戳占比=${pct(m.zeroDt)}`);
    }
    return null;
  },
  c => {
    const t = c.b.mouse.teleportRatio;
    if (t != null && t >= 0.5 && c.b.clicks > 0) {
      return hit('mouse.teleport-click', '点击前光标瞬移', 'mouse', 50, `瞬移点击占比=${pct(t)}`);
    }
    return null;
  },
  c => {
    if (c.b.clicks > 0 && c.b.mouse.clickDwellMean != null && c.b.mouse.clickDwellMean < 25) {
      return hit('mouse.press-too-short', '按下时长过短', 'mouse', 25, `平均 ${num(c.b.mouse.clickDwellMean, 0)}ms，人类通常 60–150ms`);
    }
    return null;
  },
  c => {
    // Measured against the first *click*, not the first pointer movement: an
    // OS cursor already sitting over the page fires a move at load time for
    // real users, but nobody clicks a button before the page has painted.
    const first = (c.b as any).firstClickMs;
    if (first != null && first < 20) {
      return hit('mouse.instant-interaction', '页面加载后立即点击', 'mouse', 30, `首次点击 ${num(first, 1)}ms，人类需先感知页面`);
    }
    return null;
  },

  // --- keyboard rhythm --------------------------------------------------
  c => {
    const g = c.b.keyboard.gap;
    if (g.n >= 5 && g.zeroRatio > 0.5) {
      return hit('kb.no-gaps', '连续按键无间隔', 'keyboard', 60, `${g.n} 个间隔中 ${pct(g.zeroRatio)} 为 0ms`);
    }
    return null;
  },
  c => {
    const g = c.b.keyboard.gap;
    if (g.n >= 5 && g.median > 0 && g.median < 12) {
      return hit('kb.fast-gaps', '按键间隔低于人类极限', 'keyboard', 45, `中位间隔 ${num(g.median, 1)}ms`);
    }
    return null;
  },
  c => {
    const g = c.b.keyboard.gap;
    if (g.n >= 6 && g.cv != null && g.cv < 0.15) {
      return hit('kb.metronome', '按键节奏恒定如节拍器', 'keyboard', 45, `间隔 CV=${num(g.cv, 3)}`);
    }
    return null;
  },
  c => {
    // Weak on its own: with n<8 the sample CV of a genuine human still
    // dips below 0.1. Requires more keystrokes and near-zero variance.
    const d = c.b.keyboard.dwell;
    if (d.n >= 8 && d.cv != null && d.cv < 0.06) {
      return hit('kb.dwell-constant', '每个键按下时长几乎完全相同', 'keyboard', 30, `按下时长 CV=${num(d.cv, 3)}（n=${d.n}）`);
    }
    return null;
  },
  c => {
    if (c.b.keyboard.keys >= 6 && c.b.keyboard.corrections === 0 && c.b.mouse.moveCount === 0) {
      return hit('kb.no-mouse-no-fix', '纯键盘输入且无鼠标移动', 'keyboard', 20, '未见任何指针活动或退格修正');
    }
    return null;
  },
  c => {
    if (c.b.keyboard.paste === 1 && c.b.keyboard.keys <= 2) {
      return hit('kb.paste-only', '仅粘贴无输入', 'keyboard', 25, '键盘事件极少但触发粘贴');
    }
    return null;
  },

  // --- scroll -----------------------------------------------------------
  c => {
    const s = c.b.scroll;
    if (s.events >= 6 && s.deltaCV != null && s.deltaCV < 0.05 && s.gapCV != null && s.gapCV < 0.2) {
      return hit('scroll.uniform', '滚动距离与节奏完全均匀', 'mouse', 35, `deltaCV=${num(s.deltaCV, 3)}, gapCV=${num(s.gapCV, 3)}`);
    }
    return null;
  },

  // --- touch ------------------------------------------------------------
  c => {
    const mobile = uaIsMobile(c.e.ua || '');
    if (mobile && c.b.touchStarts === 0 && (c.b.clicks > 0 || c.b.pointerTypes?.mouse > 0)) {
      return hit('touch.mobile-mouse-clicks', '移动 UA 却只产生鼠标事件', 'touch', 55, `touchstart=0，mouse 事件=${c.b.pointerTypes?.mouse || 0}`);
    }
    return null;
  },
  c => {
    if ((c.e.maxTouchPoints ?? 0) > 0 && c.b.pointerTypes?.touch && c.b.pointerTypes.touch > 0 && c.b.touchStarts === 0) {
      return hit('touch.pointer-without-touch', '有触摸指针事件但无 touchstart', 'touch', 35, '触摸事件序列缺失，仅 CDP 指针注入');
    }
    return null;
  },
  c => {
    // Touch reporting capability but zero touch ever, on a phone-shaped
    // screen, with mouse input present.
    const phoneSized = (c.e.screenH || 0) / (c.e.screenW || 1) > 1.5;
    if ((c.e.maxTouchPoints ?? 0) > 0 && phoneSized && c.b.touchStarts === 0 && c.b.pointerTypes?.mouse > 0) {
      return hit('touch.capable-but-mouse', '具备触摸能力却全程使用鼠标', 'touch', 40, `maxTouchPoints=${c.e.maxTouchPoints}，touchstart=0`);
    }
    return null;
  },

  c => {
    // Physical contact with glass cannot begin and end inside a few
    // milliseconds. CDP's dispatchTouchEvent emits touchStart and touchEnd
    // back to back; a finger cannot.
    const d = c.b.touchDwellMedian;
    if (d != null && c.b.touchStarts > 0 && d < 35) {
      return fact('touch.contact-too-short', '触摸接触时长低于物理下限', 'touch', 50, `中位接触 ${num(d, 1)}ms，真实手指 >60ms`);
    }
    return null;
  },
  c => {
    // A phone session with several touches but no touchmove means the touch
    // stream is synthetically generated: fingers always drift slightly.
    if (c.b.touchStarts >= 3 && c.b.touchMoves === 0) {
      return hit('touch.no-drift', '多次触摸但无任何触点漂移', 'touch', 30, `touchstart=${c.b.touchStarts}, touchmove=0`);
    }
    return null;
  },

  // --- integrity --------------------------------------------------------
  c => {
    if (c.b.untrustedRatio > 0.5) {
      return fact('integrity.untrusted-events', '过半事件非浏览器可信事件', 'integrity', 50, `untrusted 占比=${pct(c.b.untrustedRatio)}`);
    }
    return null;
  },
];

export function score(packet: FeaturePacket): ScoreResult {
  const ctx: Ctx = { p: packet, e: packet.env, b: packet.behavior };
  const hits: SignalHit[] = [];
  for (const rule of RULES) {
    let h: SignalHit | null = null;
    try { h = rule(ctx); } catch { h = null; }
    if (h && h.points > 0) hits.push(h);
  }

  const families = FAMILIES.map(f => {
    const own = hits.filter(h => h.family === f.id).sort((a, b) => b.points - a.points);
    const raw = own.reduce((a, h) => a + h.points, 0);
    return { id: f.id, name: f.name, cap: f.cap, points: Math.min(raw, f.cap), raw, hits: own };
  });

  // Saturating aggregation: after the highest family, each additional
  // family contributes with diminishing weight. This keeps a single strong
  // tell decisive while requiring independent corroboration for mid scores.
  const sorted = families.filter(f => f.points > 0).sort((a, b) => b.points - a.points);
  let total = 0;
  let w = 1;
  for (const f of sorted) {
    total += f.points * w;
    w *= 0.55;
  }
  const scoreVal = Math.round(Math.min(100, total));

  // Confidence: how many independent families fired. One family, even at
  // full cap, is medium confidence unless it is a hard automation marker.
  const strongFamilies = sorted.filter(f => f.points >= 25).length;
  const hardAutomation = hits.some(h => h.points >= 55 && (h.family === 'automation'));
  const confidence: ScoreResult['confidence'] =
    strongFamilies >= 3 || (strongFamilies >= 2 && hardAutomation) ? 'high'
      : strongFamilies >= 2 ? 'medium' : 'low';

  // Decision rule, in three tiers of evidence strength:
  //
  //   deterministic hit  - A contradiction or physical impossibility (touch
  //                        contact of 13ms, iOS UA advertising Client Hints).
  //                        Does not depend on a statistical threshold, so it
  //                        escalates on its own; corroboration only adds
  //                        confidence, never required to act.
  //   statistical hit    - Trajectory rhythm, typing cadence. Noisy; requires
  //                        enough evidence that one odd human session cannot
  //                        trip it, and never blocks without an environment
  //                        signal alongside.
  //
  // This split is why a fully fingerprinted-over bot is still caught: hiding
  // the environment does not make a 13ms touch physically possible.
  const deterministic = hits.some(h => h.certain);
  const envPoints = families.filter(f => f.id !== 'mouse' && f.id !== 'keyboard' && f.id !== 'touch')
    .reduce((a, f) => a + f.points, 0);
  const behaviouralOnly = envPoints === 0;
  const band: ScoreResult['band'] = scoreVal >= 65 ? 'bot' : scoreVal >= 35 ? 'suspicious' : 'human';

  let verdict: ScoreResult['verdict'] = 'allow';
  if (deterministic) {
    // One deterministic fact is enough to challenge; two independent ones, or
    // one alongside a high aggregate, block.
    const certainCount = hits.filter(h => h.certain).length;
    verdict = certainCount >= 2 || scoreVal >= 70 ? 'block' : 'challenge';
  } else if (behaviouralOnly) {
    verdict = scoreVal >= 55 ? 'challenge' : 'allow';
  } else {
    verdict = scoreVal >= 70 ? 'block' : scoreVal >= 35 ? 'challenge' : 'allow';
  }

  const top = hits.slice().sort((a, b) => b.points - a.points).slice(0, 6);

  return {
    score: scoreVal,
    band,
    confidence,
    verdict,
    families,
    top,
    summary: buildSummary(scoreVal, band, confidence, sorted, top),
    deterministic,
  };
}

function buildSummary(
  score: number,
  band: string,
  confidence: string,
  families: { name: string; points: number }[],
  top: SignalHit[],
): string {
  const fam = families.map(f => `${f.name}(${f.points})`).join('、');
  const why = top.slice(0, 3).map(h => h.label).join('；');
  const bandCn = band === 'bot' ? '判定为机器人' : band === 'suspicious' ? '疑似机器人' : '判定为人类';
  return `${bandCn}，风险分 ${score}/100（置信度 ${confidence}）。主要贡献家族：${fam || '无'}。关键信号：${why || '无'}。`;
}
