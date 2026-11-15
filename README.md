# 营销活动机器人识别系统

针对营销活动被脚本刷的场景:前端用 TypeScript 采集浏览器环境与交互行为,后端打分并给出**可解释**的判定。重点识别无头浏览器、自动化框架,以及环境信号之间的自相矛盾。

## 结果速览

| 指标 | 实测值 | 要求 |
|---|---|---|
| SDK 体积(minified) | **11.8 KiB** | < 20 KB |
| SDK 体积(gzip) | **5.1 KiB** | — |
| `init()` 同步耗时(中位) | **1.8 ms** | 不卡页面 |
| 事件处理开销 | **≈0 µs/事件** | 不卡页面 |
| 长任务(long task) | **0**(与无 SDK 页面相同) | 不卡页面 |
| 真人基线误报率 | **0 / 18** | — |
| 自动化检出率 | **18 / 18** | — |

所有数字均来自本仓库脚本的实测,见[验证方法](#验证方法)。

## 为什么这个设计能站住

### 1. 实测先行,规则不靠猜

写规则之前先跑了两轮指纹探针(`harness/probe.ts`、`probe2.ts`),覆盖 Playwright headless shell、新 headless 模式、带 stealth 补丁的 headless、headed Chromium、真实 Chrome headless/headed。关键发现直接改变了设计:

- **`isTrusted` 不能用来判自动化**。Playwright 通过 CDP 注入的鼠标/键盘事件,在页面里 `isTrusted === true`。依赖它的方案会漏掉绝大多数现代自动化。
- **Playwright 默认 headless shell 的指纹极强**:`plugins=0`、`pdfViewerEnabled=false`、`window.chrome` 不存在、WebGL 为 SwiftShader、UA 与 Client Hints 都含 `HeadlessChrome`。
- **新的 `channel:'chromium'` headless 补上了大部分 Chrome 指纹**,只剩 `HeadlessChrome` UA 与无边框窗口。这说明单点指纹不可靠,必须靠信号组合。
- **stealth 补丁本身会留痕**:删除 `navigator.webdriver` 会在 `navigator` 上留下自有属性(原生实现位于 `Navigator.prototype`),getter 也失去 `[native code]`。

### 2. 对照组必须脱离自动化管线

这是本项目最重要的方法论决定。**任何通过 CDP 连接的浏览器都会把自己标记为 `webdriver=true`**,所以拿自动化驱动的浏览器当"正常人"基线,等于用错误的标准校准阈值——之前一版正是因此把对照组误判为 55 分。

真人基线(`human` / `human-fast`)的做法:

1. 用**不带调试端口**的真实 Chrome 启动;
2. 页面通过一个仅供测试的 HTTP 接口上报自身几何位置;
3. 用 **macOS CGEvent**(`harness/native/human_input`)从操作系统层面注入鼠标/键盘,浏览器走完整原生输入管线;
4. 页面点击时 SDK 自动上报。

这样得到的会话 `webdriver=false`、插件栈完整、几何合法、输入事件经原生管线送达,在指纹层面与真实用户一致。**任何被它触发的规则都按误报处理**,必须修掉或删除。

> 诚实说明:OS 事件仍是合成的,不是人手。真人的时序变异比程序生成的大,所以本仓库用一个有文档的人类节拍模型(lognormal 间隔,中位 180ms、σ=0.55,6% 概率词组停顿;按键按下时长正态分布并有长按)来生成对照。真实人手录制仍是最终验证手段,见[局限](#已知局限)。

### 3. 确定性证据 vs 统计性证据

打分引擎把信号分两类,决策逻辑据此分层:

- **确定性(deterministic)**:矛盾或物理不可能。例如"UA 说是 iPhone,却没有触摸点"、"iOS 声称支持 Client Hints(Safari/WebKit 根本不实现)"、"触摸接触时长 0.1ms"(手指不可能按那么短)。这类证据不依赖样本量,单独一条即可升级处置。
- **统计性(statistical)**:轨迹节奏、打字间隔。噪声大,需要足量证据,且**单独出现时绝不 block**——一个真人偶尔打字很匀不该被封。

这个分层是消融实验逼出来的:把所有环境信号清成完美 Chrome 指纹后,`pw-stealth` 仅剩 `touch:50`,按纯统计阈值只到 `allow`;但 0.1ms 的触摸接触是物理不可能,按确定性规则就应升级为 `challenge`。

### 4. Ablation:证明不是靠单一信号蒙对

`harness/ablate.ts` 把捕获包逐层"洗白"再打分,验证每个家族实际扛了多少:

| 场景 | 原始 | 洗 UA | 洗 UA+插件/GL | 全环境清洗 |
|---|---|---|---|---|
| naive-bot | block | block | challenge | challenge |
| script-kiddie | block | block | block | block |
| pw-script | block | block | challenge | challenge |
| pw-stealth | block | block | challenge | challenge |
| pw-mobile | block | block | challenge | challenge |
| ua-spoof | block | challenge | allow | challenge |
| **human** | **allow** | **allow** | **allow** | **allow** |

最严苛一列(连插件栈、WebGL、几何、`webdriver` 全部伪造)下,所有攻击仍至少 `challenge`,而真人始终 `allow`。这说明结论来自多个独立家族,而非某个可被一行脚本改掉的标志位。

## 架构

```
浏览器                                    后端
┌──────────────────────────────┐         ┌────────────────────────────┐
│ BotShield SDK (11.9 KiB)     │  POST   │ /api/collect               │
│ ├ env.ts    环境事实          │ ──────► │ ├ engine.ts  规则 + 打分    │
│ │           同步只做廉价读取   │  JSON   │ │            家族封顶 + 饱和 │
│ │           WebGL/Intl/iframe  │  ~2-4KB │ │            聚合           │
│ │           延迟到首帧后空闲    │         │ └ 返回可解释结果            │
│ └ behavior.ts 指针/键盘/触摸  │ ◄────── │                            │
│             全 passive 监听   │  score  │                            │
└──────────────────────────────┘         └────────────────────────────┘
```

### 采集内容

**环境事实(`env.ts`)**
- 身份:UA、Client Hints(brands/mobile/platform)、platform、vendor、语言
- 自动化标志:`webdriver`、自动化框架全局变量、iframe 交叉校验
- 篡改检测:`navigator` 自有属性、非原生 getter、`Function.prototype.toString` 完整性
- 能力栈:插件、mimeTypes、`pdfViewerEnabled`、`window.chrome`、通知权限、触摸点数、媒体查询
- 几何:screen/avail/inner/outer/screenX/Y、DPR、visualViewport —— 窗口边框是极强的 headless 标识
- 渲染:WebGL vendor/renderer(软件渲染器是标志)、canvas 字体度量、AudioContext
- 时区/locale(延迟采集,见下)

**行为事实(`behavior.ts`)**
- 指针:轨迹(降采样至 ≤48 点)、直线度、段长变异、时间间隔变异、方向变化率、瞬移检测
- 点击:按下时长、点击前是否瞬移、首次点击延迟
- 键盘:按键间隔中位数/CV/零间隔比例、按下时长、退格修正、粘贴
- 触摸:接触时长、触点漂移、多点触控
- 滚动:间隔与步长均匀性
- 完整性:不可信事件比例

### 性能设计

- 同步路径只做廉价属性读取;`init()` 中位 **1.8ms**
- WebGL 上下文创建(实测 19ms)、`Intl.DateTimeFormat` 首次调用(实测 4.9ms ICU 冷启动)、iframe 探测(1.8ms)全部**延迟到首帧之后的 `requestIdleCallback`**
- 所有监听器 `passive`,热路径只往预分配 `Float64Array` 写数字,不读 DOM、不触发布局
- 轨迹在客户端降采样后才上传,原始输入(可能含 PII)不出设备
- 实测:20,000 次 `pointermove` 相比无 SDK 页面开销 ≈0;长任务数与基线持平

### 打分模型

1. 每条规则产出至多一个 hit(分数 + 证据字符串 + 是否确定性)
2. 按 6 个家族分组并**封顶**,防止单一噪声家族主导:自动化 100 / 矛盾 100 / 完整性 60 / 鼠标 80 / 键盘 70 / 触摸 50
3. 家族分数按降序**饱和聚合**(权重 1, 0.55, 0.30, …),使单一强信号即可定性,中等分需要独立佐证
4. 决策分层:确定性证据 → `challenge`/`block`;仅行为证据 → 最高 `challenge`,永不 `block`;否则按总分
5. 输出每个家族的分数、命中的每条规则及证据、置信度、处置建议与中文摘要

### 可解释输出示例

```json
{
  "score": 100,
  "band": "bot",
  "confidence": "high",
  "verdict": "block",
  "deterministic": true,
  "families": [
    { "id": "automation", "name": "自动化框架痕迹", "points": 100, "cap": 100, "raw": 235 },
    { "id": "contradiction", "name": "环境信号自相矛盾", "points": 95, "cap": 100, "raw": 95 },
    { "id": "touch", "name": "触摸行为", "points": 50, "cap": 50, "raw": 50 }
  ],
  "top": [
    { "id": "auto.headless-ua", "points": 90, "certain": true,
      "label": "UA/Client Hints 直接暴露 HeadlessChrome",
      "evidence": "userAgent 或 brand 列表含 \"HeadlessChrome\"" },
    { "id": "contra.ios-with-client-hints", "points": 60, "certain": true,
      "label": "iOS UA 却支持 Client Hints",
      "evidence": "Safari/WebKit 不实现 navigator.userAgentData" },
    { "id": "touch.contact-too-short", "points": 50, "certain": true,
      "label": "触摸接触时长低于物理下限",
      "evidence": "中位接触 0.1ms，真实手指 >60ms" }
  ],
  "summary": "判定为机器人，风险分 100/100（置信度 high）。主要贡献家族：自动化框架痕迹(100)、环境信号自相矛盾(95)、触摸行为(50)。关键信号：UA/Client Hints 直接暴露 HeadlessChrome；iOS UA 却支持 Client Hints；触摸接触时长低于物理下限。"
}
```

## 使用

```bash
npm install
npm run build        # 构建 SDK,输出体积报告,超 20KB 直接失败
npm test             # 21 项测试(引擎规则 + SDK 契约 + 体积守卫)
npm run serve        # 演示站 http://127.0.0.1:8787
```

页面接入:

```ts
const bs = BotShield.init({
  endpoint: '/api/collect',   // 留空则离线,仅 snapshot()
  siteKey: 'shop-key',
  autoSend: true,             // pagehide/visibilitychange 时自动上报
});
// 在关键动作(领券、下单)时主动上报并拿到判定
bs.send().then(result => {
  if (result.verdict === 'block') showCaptcha();
});
```

## 验证方法

```bash
npm run harness    # 跑全部场景,捕获特征包
npm run bench      # 重复采样的分数分布 / 误报率 / 检出率
npm run ablate     # 逐层移除环境证据,看行为信号能否独立支撑
npm run perf       # 体积、init 耗时、事件开销、长任务
npm run verify     # 以上全部
```

### 测试场景(`harness/run.ts`)

| 场景 | 模拟的攻击 | 类别 |
|---|---|---|
| `naive-bot` | 直接 `element.click()`,零鼠标轨迹 | 自动化 |
| `script-kiddie` | `setInterval` 线性插值 + 固定 16ms 节奏 | 自动化 |
| `pw-script` | Playwright 原生 API(`mouse.move` steps + `keyboard.type`) | 自动化 |
| `pw-stealth` | Playwright + 删除 webdriver / 伪造 plugins / 改 UA | 自动化 |
| `pw-mobile` | Playwright 移动端模拟 + CDP 触摸注入 | 自动化 |
| `ua-spoof` | 真实 Chrome 只改 UA 字符串 | 自动化 |
| `human` | 真实 Chrome,无调试端口,OS 级 CGEvent | 对照 |
| `human-fast` | 同上,偏快节奏 | 对照 |

## 已知局限

1. **OS 对照组是合成的,不是真人录制**。CGEvent 注入走原生管线,但时序来自人类节拍模型而非真人手部肌肉。真实人手的间隔变异更大,理论上更难误报,但这一点未经真人数据直接验证。要补真人数据,需要延长采集时长并接入真实用户会话。
2. **不以 `isTrusted` 作为判据**。它与检测目标无关(实测 CDP 事件仍为 true),本系统仅把它当作"事件是否被脚本伪造"的辅助信号,权重低。
3. **对抗性隐身不保证覆盖**。如果攻击者同时伪造 Client Hints、插件栈、WebGL 渲染器、窗口几何,并注入带抖动和曲线的合成轨迹,指纹层面就基本无法与真人区分。此时只剩行为统计与完整性检查,`ua-spoof` 在消融表里降到 `allow` 正是这种情况的写照。这类攻防是持续升级的过程,不是一次性解法。
4. **Firefox / Safari 未实测**。规则里针对 Firefox 的 Client Hints 矛盾是按标准推的,未跑真机验证。
5. **样本量有限**。真人 18 次、每种攻击 3 次。0/18 的误报率单侧 95% 置信上界为 15.3%,不能理解为"永不误报"。生产环境应持续收集误报并回归。

## 目录结构

```
src/sdk/          采集 SDK(env.ts 环境 / behavior.ts 行为 / index.ts 入口)
src/server/       服务端(score/engine.ts 规则与打分,index.ts HTTP)
src/shared/       共享类型
test/             引擎规则、SDK 契约、体积守卫
harness/          测试驱动、探针、ablation、性能测量
harness/native/   macOS CGEvent 注入辅助(swift,需自行编译)
data/results/     实测产物(不提交)
```

> 需要说明的是:`harness/native` 下的注入程序依赖 macOS 辅助功能权限,仅用于本地测试;真实部署不包含任何此类代码。
