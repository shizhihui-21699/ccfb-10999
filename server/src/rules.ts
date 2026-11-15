/**
 * Rule library. Each rule is a pure function over the report and returns zero
 * or one piece of evidence. Negative weights are legitimate: they express
 * positive human-like signals and make the additive model self-correcting.
 */
import type { BotGuardReport, EnvSignals, BehaviorSignals } from '../../shared/protocol.ts';
import type { Category, SignalEvidence } from './types.ts';

type Ctx = { env: EnvSignals; beh: BehaviorSignals };

interface Rule {
  id: string;
  category: Category;
  severity: SignalEvidence['severity'];
  weight: number;
  reason: string;
  expected?: string;
  test: (ctx: Ctx, report: BotGuardReport) => { fired: boolean; observed?: unknown };
}

function ev(rule: Rule, observed: unknown): SignalEvidence {
  return {
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    weight: rule.weight,
    reason: rule.reason,
    observed,
    ...(rule.expected ? { expected: rule.expected } : {}),
  };
}

const isMobileUA = (ua: string): boolean => /android|iphone|ipad|ipod|mobile/i.test(ua);
const isDesktopUA = (ua: string): boolean => /windows|macintosh|linux x86|cros/i.test(ua);
const isChromiumUA = (ua: string): boolean => /chrome|chromium|headlesschrome/i.test(ua);

// ---------------------------------------------------------------------------
// Category 1: headless browser evidence (cap 40)
// ---------------------------------------------------------------------------

const HEADLESS_RULES: Rule[] = [
  {
    id: 'HEADLESS_UA_STRING',
    category: 'headless',
    severity: 'high',
    weight: 22,
    reason: 'User-Agent 中直接包含 HeadlessChrome 标识',
    expected: '常规 Chrome UA 不含 Headless 字样',
    test: ({ env }) => ({ fired: /headless/i.test(env.ua), observed: env.ua }),
  },
  {
    id: 'HEADLESS_WEBDRIVER',
    category: 'headless',
    severity: 'high',
    weight: 14,
    reason: 'navigator.webdriver === true,浏览器正被 WebDriver 协议控制',
    expected: '普通用户浏览器为 false/undefined',
    test: ({ env }) => ({ fired: env.webdriver, observed: env.webdriver }),
  },
  {
    id: 'HEADLESS_CDC_VARS',
    category: 'headless',
    severity: 'high',
    weight: 12,
    reason: 'window/document 上存在 ChromeDriver 注入的 cdc_ 变量',
    expected: '无 cdc_ 前缀变量',
    test: ({ env }) => ({ fired: env.cdcVars.length > 0, observed: env.cdcVars }),
  },
  {
    id: 'HEADLESS_SWIFTSHADER',
    category: 'headless',
    severity: 'medium',
    weight: 10,
    reason: 'WebGL 使用 SwiftShader/软件渲染,无头环境典型特征',
    expected: '硬件 GPU 渲染器(如 Apple M1、Intel Iris、NVIDIA)',
    test: ({ env }) => {
      const gl = `${env.webgl.vendor} ${env.webgl.renderer}`;
      const hit = /swiftshader|software|llvmpipe|mesa|basic/i.test(gl);
      return { fired: hit, observed: gl.trim() || 'WebGL 不可用' };
    },
  },
  {
    id: 'HEADLESS_MISSING_CHROME',
    category: 'headless',
    severity: 'medium',
    weight: 8,
    reason: 'Chromium 系 UA 却没有 window.chrome 对象(新版无头模式特征)',
    expected: '桌面 Chrome 存在 window.chrome',
    test: ({ env }) => ({
      fired: isChromiumUA(env.ua) && !env.chrome.present,
      observed: { ua: env.ua.slice(0, 60), hasWindowChrome: env.chrome.present },
    }),
  },
  {
    id: 'HEADLESS_OUTER_INNER_ZERO',
    category: 'headless',
    severity: 'medium',
    weight: 6,
    reason: 'window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框',
    expected: '有头桌面浏览器差值通常 >0(含侧边栏/窗口边框)',
    test: ({ env }) => ({
      fired: isChromiumUA(env.ua) && isDesktopUA(env.ua) && env.iframe.outerInnerDiff === 0,
      observed: env.iframe.outerInnerDiff,
    }),
  },
  {
    id: 'HEADLESS_SCREEN_EQUALS_VIEWPORT',
    category: 'headless',
    severity: 'low',
    weight: 5,
    reason: '屏幕分辨率恰好等于视口大小,常见于 headless 默认 800x600/1280x720',
    expected: '真实桌面存在任务栏/工具栏,二者不相等',
    test: ({ env }) => ({ fired: env.iframe.screenEqualsViewport, observed: env.screen }),
  },
  {
    id: 'HEADLESS_NOTIF_DENIED',
    category: 'headless',
    severity: 'low',
    weight: 4,
    reason: 'Notification 权限默认 denied,无头 Chrome 的默认行为',
    expected: '普通浏览器默认 default(需用户主动拒绝才是 denied)',
    test: ({ env }) => ({
      fired: env.notification.supported && env.notification.permission === 'denied',
      observed: env.notification.permission,
    }),
  },
  {
    id: 'HEADLESS_PLUGINS_EMPTY',
    category: 'headless',
    severity: 'low',
    weight: 4,
    reason: '桌面 Chromium 的 navigator.plugins 为空',
    expected: '桌面 Chrome 至少含 PDF Viewer 等内置插件',
    test: ({ env }) => ({
      fired: isDesktopUA(env.ua) && isChromiumUA(env.ua) && env.plugins.length === 0,
      observed: env.plugins.names,
    }),
  },
  {
    id: 'HEADLESS_LANGUAGES_EMPTY',
    category: 'headless',
    severity: 'low',
    weight: 4,
    reason: 'navigator.languages 为空数组',
    expected: '真实浏览器至少配置一种语言',
    test: ({ env }) => ({ fired: env.languages.length === 0, observed: env.languages }),
  },
  {
    id: 'HEADLESS_CANVAS_BLOCKED',
    category: 'headless',
    severity: 'low',
    weight: 4,
    reason: 'Canvas 读取被拦截或抛错,常见于反指纹自动化配置',
    expected: '普通浏览器可正常 toDataURL',
    test: ({ env }) => ({ fired: env.canvas.blocked, observed: env.canvas }),
  },
  {
    id: 'HEADLESS_HUMAN_GL',
    category: 'headless',
    severity: 'low',
    weight: -4,
    reason: '检测到真实硬件 GPU 渲染器,降低无头嫌疑',
    test: ({ env }) => {
      const gl = `${env.webgl.vendor} ${env.webgl.renderer}`;
      const hw = /apple|intel|nvidia|amd|radeon|adreno|mali|qualcomm/i.test(gl);
      return { fired: hw && !/swiftshader|llvmpipe/i.test(gl), observed: gl.trim() };
    },
  },
];

// ---------------------------------------------------------------------------
// Category 2: automation framework evidence (cap 35)
// ---------------------------------------------------------------------------

const AUTOMATION_RULES: Rule[] = [
  {
    id: 'AUTO_GLOBALS_LEAK',
    category: 'automation',
    severity: 'high',
    weight: 18,
    reason: '全局作用域存在自动化框架注入变量(puppeteer/playwright/selenium 等)',
    expected: 'window 上无自动化框架变量',
    test: ({ env }) => ({ fired: env.automationGlobals.length > 0, observed: env.automationGlobals }),
  },
  {
    id: 'AUTO_NATIVE_TAMPERED',
    category: 'automation',
    severity: 'high',
    weight: 0, // 动态权重,见 dynamicWeight
    reason: '浏览器核心原生函数的 toString 不含 [native code],已被脚本 hook/替换',
    expected: '原生函数源码应为 function xxx() { [native code] }',
    test: ({ env }) => {
      // A lone webdriver-getter patch is a weak, common anti-detection tweak;
      // it has its own contradiction rule and must not count as core API hooking.
      const core = env.tamperedNatives.filter((n: string) => !n.includes('webdriver'));
      return { fired: core.length > 0, observed: core };
    },
  },
  {
    id: 'AUTO_WEBDRIVER_GETTER_PATCH',
    category: 'automation',
    severity: 'low',
    weight: 4,
    reason: '仅 navigator.webdriver 的 getter 被替换为非原生函数(轻度反检测补丁)',
    expected: '未做补丁时该 getter 为原生',
    test: ({ env }) => ({
      fired: env.tamperedNatives.some((n: string) => n.includes('webdriver')),
      observed: env.tamperedNatives.filter((n: string) => n.includes('webdriver')),
    }),
  },
  {
    id: 'AUTO_CDP_STACK',
    category: 'automation',
    severity: 'medium',
    weight: 10,
    reason: '错误堆栈中出现 puppeteer/playwright/webdriver 注入帧',
    expected: '堆栈仅包含页面自身脚本',
    test: ({ env }) => {
      const stackHits = env.headlessFlags.filter((f: string) => f.startsWith('stack-'));
      return { fired: stackHits.length > 0, observed: stackHits };
    },
  },
  {
    id: 'AUTO_MOUSE_UNTRUSTED',
    category: 'automation',
    severity: 'high',
    weight: 16,
    reason: '鼠标事件 isTrusted=false,由 dispatchEvent 合成而非真实输入设备',
    expected: '真实硬件产生的事件 isTrusted 恒为 true',
    test: ({ beh }) => ({
      fired: beh.mouse.count >= 5 && beh.mouse.untrustedRatio >= 0.5,
      observed: { ratio: Number(beh.mouse.untrustedRatio.toFixed(2)), count: beh.mouse.count },
    }),
  },
  {
    id: 'AUTO_KEY_UNTRUSTED',
    category: 'automation',
    severity: 'high',
    weight: 14,
    reason: '键盘事件 isTrusted=false,由脚本合成',
    expected: '真实键盘事件 isTrusted 恒为 true',
    test: ({ beh }) => ({
      fired: beh.keyboard.count >= 5 && beh.keyboard.untrustedRatio >= 0.5,
      observed: { ratio: Number(beh.keyboard.untrustedRatio.toFixed(2)), count: beh.keyboard.count },
    }),
  },
  {
    id: 'AUTO_CLICK_UNTRUSTED',
    category: 'automation',
    severity: 'medium',
    weight: 10,
    reason: '点击事件 isTrusted=false',
    expected: '真实点击 isTrusted=true',
    test: ({ beh }) => ({
      fired: beh.click.count >= 3 && beh.click.untrustedRatio >= 0.5,
      observed: { ratio: Number(beh.click.untrustedRatio.toFixed(2)), count: beh.click.count },
    }),
  },
  {
    id: 'AUTO_SCROLL_UNTRUSTED',
    category: 'automation',
    severity: 'medium',
    weight: 8,
    reason: '滚动事件 isTrusted=false,由 scrollTo/scrollIntoView 触发',
    expected: '用户滚动 isTrusted=true',
    test: ({ beh }) => ({
      fired: beh.scroll.count >= 3 && beh.scroll.untrustedRatio >= 0.5,
      observed: { ratio: Number(beh.scroll.untrustedRatio.toFixed(2)), count: beh.scroll.count },
    }),
  },
  {
    id: 'AUTO_PERM_GRANTED_ALL',
    category: 'automation',
    severity: 'medium',
    weight: 8,
    reason: '摄像头/麦克风/通知等敏感权限全部 granted,典型的自动化授权绕过',
    expected: '真实用户环境多为 default/prompt,极少全部授予',
    test: ({ env }) => {
      const p = env.permissions;
      const sensitive = ['notifications', 'geolocation', 'camera', 'microphone'].filter((k) => p[k]);
      if (sensitive.length < 3) return { fired: false };
      const granted = sensitive.filter((k) => p[k] === 'granted');
      return { fired: granted.length >= 3, observed: p };
    },
  },
  {
    id: 'AUTO_HUMAN_TRUSTED_EVENTS',
    category: 'automation',
    severity: 'low',
    weight: -5,
    reason: '采集到足量 isTrusted=true 的输入事件,说明存在真实输入设备',
    test: ({ beh }) => {
      const total = beh.mouse.count + beh.keyboard.count;
      const trusted =
        beh.mouse.count * (1 - beh.mouse.untrustedRatio) +
        beh.keyboard.count * (1 - beh.keyboard.untrustedRatio);
      return { fired: total >= 20 && trusted / total >= 0.95, observed: { total, trusted: Math.round(trusted) } };
    },
  },
];

// ---------------------------------------------------------------------------
// Category 3: environment contradictions (cap 25)
// ---------------------------------------------------------------------------

const CONTRADICTION_RULES: Rule[] = [
  {
    id: 'CONTRA_MOBILE_UA_NO_TOUCH',
    category: 'contradiction',
    severity: 'high',
    weight: 14,
    reason: 'UA 声称是移动设备,但 maxTouchPoints=0 且无 coarse pointer',
    expected: '手机/平板 UA 应具备触摸能力',
    test: ({ env }) => ({
      fired: isMobileUA(env.ua) && env.touch.maxTouchPoints === 0 && !env.touch.coarsePointer,
      observed: { ua: env.ua.slice(0, 60), maxTouchPoints: env.touch.maxTouchPoints, coarse: env.touch.coarsePointer },
    }),
  },
  {
    id: 'CONTRA_DESKTOP_UA_TOUCH',
    category: 'contradiction',
    severity: 'medium',
    weight: 10,
    reason: '桌面 UA 却报告多点触控能力,环境伪装前后不一致',
    expected: '桌面设备 maxTouchPoints 通常为 0',
    test: ({ env }) => ({
      fired: isDesktopUA(env.ua) && env.touch.maxTouchPoints > 1,
      observed: { ua: env.ua.slice(0, 60), maxTouchPoints: env.touch.maxTouchPoints },
    }),
  },
  {
    id: 'CONTRA_TOUCH_FLAGS_SPLIT',
    category: 'contradiction',
    severity: 'medium',
    weight: 8,
    reason: '触摸信号自相矛盾:ontouchstart 与 maxTouchPoints/coarse pointer 结论相反',
    expected: '三项触摸探测应结论一致',
    test: ({ env }) => {
      const t = env.touch;
      const split = t.ontouchstart !== (t.maxTouchPoints > 0) || (t.maxTouchPoints > 0) !== t.coarsePointer;
      return { fired: split, observed: t };
    },
  },
  {
    id: 'CONTRA_PLATFORM_UA_MISMATCH',
    category: 'contradiction',
    severity: 'high',
    weight: 12,
    reason: 'UA 中的操作系统与 navigator.platform / UA-CH platform 不一致',
    expected: '两处平台标识指向同一 OS',
    test: ({ env }) => {
      if (!env.platform) return { fired: false };
      const ua = env.ua.toLowerCase();
      const pf = env.platform.toLowerCase();
      const mismatch =
        (/windows/.test(ua) && /mac|iphone|linux|android/.test(pf)) ||
        (/macintosh|iphone|ipad/.test(ua) && /win|linux|android/.test(pf)) ||
        (/android/.test(ua) && /win|mac|iphone/.test(pf)) ||
        (/linux/.test(ua) && /win|mac|iphone|android/.test(pf));
      return { fired: mismatch, observed: { ua: env.ua.slice(0, 60), platform: env.platform } };
    },
  },
  {
    id: 'CONTRA_VIEWPORT_LARGER_SCREEN',
    category: 'contradiction',
    severity: 'medium',
    weight: 8,
    reason: '视口尺寸大于屏幕物理尺寸,几何参数不可能成立',
    expected: '视口不超过屏幕分辨率',
    test: ({ env }) => ({
      fired: env.viewport.w > env.screen.w || env.viewport.h > env.screen.h,
      observed: { viewport: env.viewport, screen: { w: env.screen.w, h: env.screen.h } },
    }),
  },
  {
    id: 'CONTRA_DPR_ZERO',
    category: 'contradiction',
    severity: 'low',
    weight: 5,
    reason: 'devicePixelRatio 为 0,真实浏览器不可能出现',
    expected: 'DPR ≥ 1',
    test: ({ env }) => ({ fired: env.dpr === 0, observed: env.dpr }),
  },
  {
    id: 'CONTRA_CORES_ZERO',
    category: 'contradiction',
    severity: 'low',
    weight: 5,
    reason: 'hardwareConcurrency 为 0,真实设备至少报告 1 核',
    expected: '通常 4–16',
    test: ({ env }) => ({ fired: env.cores === 0, observed: env.cores }),
  },
  {
    id: 'CONTRA_ZERO_DIMENSION_SCREEN',
    category: 'contradiction',
    severity: 'medium',
    weight: 8,
    reason: 'screen 宽/高为 0,屏幕信息被抹除或伪造失败',
    expected: '真实屏幕宽高均 >0',
    test: ({ env }) => ({ fired: env.screen.w === 0 || env.screen.h === 0, observed: env.screen }),
  },
  {
    id: 'CONTRA_WEBDRIVER_HIDDEN_BADLY',
    category: 'contradiction',
    severity: 'low',
    weight: 5,
    reason: 'webdriver 被改成 false,但 Navigator.prototype 上的 getter 已非原生(补丁式伪装痕迹;隐私工具也可能触发,仅作佐证)',
    expected: '无补丁时 webdriver getter 为原生',
    test: ({ env }) => ({
      fired: !env.webdriver && env.tamperedNatives.some((n: string) => n.includes('webdriver')),
      observed: env.tamperedNatives.filter((n: string) => n.includes('webdriver')),
    }),
  },
  {
    id: 'CONTRA_CANVAS_FP_NULLISH',
    category: 'contradiction',
    severity: 'low',
    weight: 4,
    reason: 'Canvas 指纹为空但未报告 blocked,指纹链路被静默篡改',
    expected: '正常读取应返回非空 hash',
    test: ({ env }) => ({ fired: !env.canvas.blocked && env.canvas.hash === '', observed: env.canvas }),
  },
  {
    id: 'CONTRA_MOBILE_COARSE_NO_TOUCHPOINTS',
    category: 'contradiction',
    severity: 'low',
    weight: 6,
    reason: 'coarse pointer 为真但 maxTouchPoints=0,指针媒体查询与触摸 API 冲突',
    expected: '两者应同时指示触摸设备',
    test: ({ env }) => ({
      fired: env.touch.coarsePointer && env.touch.maxTouchPoints === 0,
      observed: env.touch,
    }),
  },
];

// ---------------------------------------------------------------------------
// Category 4: behavioral anomalies (cap 25)
// Rules here only fire when enough samples exist — thin data is reported via
// dataQuality, never punished.
// ---------------------------------------------------------------------------

const BEHAVIOR_RULES: Rule[] = [
  {
    id: 'BEH_MOUSE_STRAIGHT_LINES',
    category: 'behavior',
    severity: 'medium',
    weight: 10,
    reason: '鼠标轨迹中直线段占比过高,缺少人类移动的自然弧度',
    expected: '真人直线路径占比通常 <0.5',
    test: ({ beh }) => ({
      fired: beh.mouse.count >= 30 && beh.mouse.straightLineRatio >= 0.85,
      observed: { ratio: Number(beh.mouse.straightLineRatio.toFixed(2)), count: beh.mouse.count },
    }),
  },
  {
    id: 'BEH_MOUSE_INTERVAL_TOO_REGULAR',
    category: 'behavior',
    severity: 'medium',
    weight: 9,
    reason: '鼠标事件间隔变异系数极低,节奏像定时器而非人手',
    expected: '真人间隔 CV 通常 >0.35',
    test: ({ beh }) => ({
      fired: beh.mouse.count >= 30 && beh.mouse.intervalCV > 0 && beh.mouse.intervalCV < 0.15,
      observed: { cv: Number(beh.mouse.intervalCV.toFixed(3)), mean: Number(beh.mouse.intervalMean.toFixed(1)) },
    }),
  },
  {
    id: 'BEH_MOUSE_SPEED_INVARIANT',
    category: 'behavior',
    severity: 'medium',
    weight: 8,
    reason: '鼠标速度变异系数极低,缺少人类加减速/停顿',
    expected: '真人速度 CV 通常 >0.5',
    test: ({ beh }) => ({
      fired: beh.mouse.count >= 30 && beh.mouse.speedCV > 0 && beh.mouse.speedCV < 0.2,
      observed: { speedCV: Number(beh.mouse.speedCV.toFixed(3)) },
    }),
  },
  {
    id: 'BEH_MOUSE_STATIONARY_LOW',
    category: 'behavior',
    severity: 'low',
    weight: 4,
    reason: '轨迹几乎没有静止点,脚本持续派发移动事件',
    expected: '真人会在悬停/阅读时产生静止点',
    test: ({ beh }) => ({
      fired: beh.mouse.count >= 60 && beh.mouse.stationaryRatio < 0.01,
      observed: { stationary: Number(beh.mouse.stationaryRatio.toFixed(3)), count: beh.mouse.count },
    }),
  },
  {
    id: 'BEH_KEY_RHYTHM_ROBOTIC',
    category: 'behavior',
    severity: 'medium',
    weight: 10,
    reason: '按键间隔变异系数极低且均值落在机器典型区间,打字节奏过于均匀',
    expected: '真人按键间隔 CV 通常 >0.25,均值 80–250ms 且分布发散',
    test: ({ beh }) => {
      const k = beh.keyboard;
      const robotic = k.count >= 12 && k.intervalCV > 0 && k.intervalCV < 0.12;
      return { fired: robotic, observed: { cv: Number(k.intervalCV.toFixed(3)), mean: Number(k.intervalMean.toFixed(1)) } };
    },
  },
  {
    id: 'BEH_CLICK_DUPLICATE_SPAM',
    category: 'behavior',
    severity: 'low',
    weight: 6,
    reason: '多次点击落在完全相同的像素坐标,脚本定点重复点击',
    expected: '真人连续点击坐标存在像素级抖动',
    test: ({ beh }) => ({
      fired: beh.click.count >= 5 && beh.click.duplicateRatio >= 0.8,
      observed: { ratio: Number(beh.click.duplicateRatio.toFixed(2)), count: beh.click.count },
    }),
  },
  {
    id: 'BEH_SCROLL_UNIFORM',
    category: 'behavior',
    severity: 'low',
    weight: 6,
    reason: '滚动增量完全一致,wheel 事件由脚本以固定步长派发',
    expected: '真人滚动增量大小不一',
    test: ({ beh }) => ({
      fired: beh.scroll.count >= 6 && beh.scroll.uniformDeltaRatio >= 0.8,
      observed: { ratio: Number(beh.scroll.uniformDeltaRatio.toFixed(2)), count: beh.scroll.count },
    }),
  },
  {
    id: 'BEH_NO_INPUT_LONG_SESSION',
    category: 'behavior',
    severity: 'low',
    weight: 6,
    reason: '会话超过 8 秒却没有任何鼠标/键盘/滚动输入,典型无头脚本静默跑流程',
    expected: '真人会话会产生交互事件',
    test: ({ beh }) => {
      const total = beh.mouse.count + beh.keyboard.count + beh.scroll.count + beh.click.count;
      return { fired: beh.sessionDuration >= 8000 && total === 0, observed: { duration: beh.sessionDuration, total } };
    },
  },
  {
    id: 'BEH_HUMAN_RHYTHM',
    category: 'behavior',
    severity: 'low',
    weight: -6,
    reason: '打字节奏呈现人类特征:高变异且均值在真人区间',
    test: ({ beh }) => {
      const k = beh.keyboard;
      const human =
        k.count >= 12 && k.intervalCV >= 0.25 && k.intervalMean >= 60 && k.intervalMean <= 400 && k.dwellMean > 0;
      return {
        fired: human,
        observed: { cv: Number(k.intervalCV.toFixed(3)), mean: Number(k.intervalMean.toFixed(1)), dwell: Number(k.dwellMean.toFixed(1)) },
      };
    },
  },
  {
    id: 'BEH_HUMAN_MOUSE_DYNAMICS',
    category: 'behavior',
    severity: 'low',
    weight: -6,
    reason: '鼠标动力学呈人类特征:速度变化丰富且存在自然停顿',
    test: ({ beh }) => {
      const m = beh.mouse;
      const human = m.count >= 30 && m.speedCV >= 0.5 && m.stationaryRatio >= 0.02 && m.straightLineRatio < 0.85;
      return {
        fired: human,
        observed: { speedCV: Number(m.speedCV.toFixed(3)), stationary: Number(m.stationaryRatio.toFixed(3)) },
      };
    },
  },
];

export const RULE_SETS: Record<Category, { rules: Rule[]; cap: number; label: string }> = {
  headless: { rules: HEADLESS_RULES, cap: 45, label: '无头浏览器特征' },
  automation: { rules: AUTOMATION_RULES, cap: 30, label: '自动化框架痕迹' },
  contradiction: { rules: CONTRADICTION_RULES, cap: 20, label: '环境信号矛盾' },
  behavior: { rules: BEHAVIOR_RULES, cap: 20, label: '行为异常' },
};

/** Dynamic weight for native-tampering: more hooked core surfaces => stronger. */
function dynamicWeight(rule: Rule, ctx: Ctx): number {
  if (rule.id !== 'AUTO_NATIVE_TAMPERED') return rule.weight;
  const core = ctx.env.tamperedNatives.filter((n) => !n.includes('webdriver'));
  return Math.min(16, 7 + core.length * 2);
}

export function evaluateRules(report: BotGuardReport): Map<Category, SignalEvidence[]> {
  const ctx: Ctx = { env: report.env, beh: report.behavior };
  const out = new Map<Category, SignalEvidence[]>();
  for (const [category, set] of Object.entries(RULE_SETS) as [Category, (typeof RULE_SETS)[Category]][]) {
    const fired: SignalEvidence[] = [];
    for (const rule of set.rules) {
      let res: { fired: boolean; observed?: unknown };
      try {
        res = rule.test(ctx, report);
      } catch {
        continue; // a broken rule never breaks scoring
      }
      if (res.fired) {
        const e = ev(rule, res.observed ?? true);
        if (rule.id === 'AUTO_NATIVE_TAMPERED') e.weight = dynamicWeight(rule, ctx);
        fired.push(e);
      }
    }
    out.set(category, fired);
  }
  return out;
}
