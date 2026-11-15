# BotGuard — 营销活动机器人识别系统

浏览器端信号采集 SDK(TypeScript)+ 可解释规则评分引擎(Node)+ Playwright 自动化/真人对照测试台。

## 能力概览

| 需求 | 实现 |
|---|---|
| 前端采集 SDK(TypeScript) | `sdk/`,零运行时依赖,esbuild 打包 |
| 浏览器环境 / 鼠标轨迹 / 按键节奏 | 40+ 环境探针 + 行为环形缓冲与统计聚合 |
| 重点识别无头浏览器与自动化框架 | 12 条无头规则 + 10 条自动化规则 |
| 环境信号互相矛盾检测 | 11 条矛盾规则(如移动 UA 无触摸) |
| 分数可解释 | 每条规则携带 id / 权重 / reason / observed / expected |
| SDK < 20KB | **18.01 KB raw / 6.49 KB gzip**,构建时硬性校验 |
| 采集不卡页面 | 被动监听 + ring buffer + idle 聚合,实测 6000 事件 **0 个 long task** |
| Playwright 跑自动化脚本 | 8 个机器人场景 + 3 个有头自动化场景 |
| 真人操作对照 | 类人贝塞尔对照组 + 真人录制/回放工具 |

## 目录结构

```
sdk/
  src/
    types.ts        载荷类型(转引自 shared/protocol)
    probes.ts       环境探针:无头特征、自动化全局变量、原生函数完整性、
                    Canvas/WebGL/Audio 指纹、权限、插件、CSS 探针…
    behavior.ts     鼠标/键盘/滚动/点击/触摸/焦点采集与统计聚合
    transport.ts    sendBeacon / fetch keepalive 上报
    util.ts         RingBuffer、统计量、FNV hash、原生函数校验
    index.ts        入口 init(),全局 window.BotGuard
  build.mjs         打包 + 20KB 预算硬校验
shared/protocol.ts  SDK 与服务端唯一的载荷协议数据源
server/
  src/
    rules.ts        规则库(4 类 40+ 条,含负权重人类信号)
    scorer.ts       分类封顶 + 硬判定 + 阈值 + 证据汇总
    index.ts        零依赖 HTTP 采集服务(收报告/评分/静态托管)
    cli.ts          命令行打分:cat report.json | node cli.ts
tests/
  harness/          模拟营销活动页(表单/按钮/滚动区)
  e2e/              Playwright 断言测试(11 个有效用例)
  lib/
    helpers.ts      机器人/类人/合成事件动作库、stealth 注入脚本
    recorder.ts     真人操作录制器(npm run record)
    replayer.ts     录制轨迹回放
    report.ts       对照实验报告生成器(markdown + json)
    perf-check.ts   不卡页面性能验证
```

## 快速开始

```bash
npm install
npm run build:sdk        # 构建 SDK 并校验 <20KB
npm run typecheck        # 三个工程的严格类型检查
npm test                 # 跑 Playwright 断言套件(headless + headed 两项目)
npm run test:report      # 生成 9 场景对照报告到 tests/results/
npm run start:server     # 单独启动采集服务 http://127.0.0.1:8790
```

真人录制(需要桌面窗口环境,60 秒):

```bash
npm run start:server &
npm run record -- tests/results/human-trace.json
# 在弹出的浏览器里像真实用户一样操作;回放用例 HUM-2 会自动启用
```

## 评分模型设计

### 四类信号,分类封顶(防止单一维度刷分)

| 分类 | 上限 | 关注点 |
|---|---|---|
| 无头浏览器特征 | 45 | HeadlessChrome UA、webdriver、SwiftShader、缺 window.chrome、几何异常… |
| 自动化框架痕迹 | 30 | 框架全局变量泄露、原生函数被 hook、isTrusted=false、权限全授予… |
| 环境信号矛盾 | 20 | 移动 UA 无触摸、平台/UA 不一致、视口大于屏幕、触摸信号自相矛盾… |
| 行为异常 | 20 | 直线轨迹、节奏过于均匀、速度无变化、定点重复点击、固定步长滚动… |

### 三个关键设计

1. **负权重人类信号**:真人特征(硬件 GPU、isTrusted 事件、人类打字节奏、丰富鼠标动力学)给负分,可在同分类内抵消可疑信号,让模型自我修正、压低误报。
2. **高置信度硬判定**:分数封顶不能埋没取证级证据。**两条及以上 distinct 的 severity=high 信号直接判 bot**(例如 HeadlessChrome UA 与 webdriver=true 同时出现,真实用户机器上不可能共存);一条 high 至少 suspect。
3. **薄数据不惩罚**:行为规则都有最小样本量门槛(如鼠标 ≥30 样本),数据不足通过 `dataQuality.behaviorInsufficient` 标注,而不是凑数判负。

### 判定阈值

```
score >= 60           → bot
30 <= score < 60      → suspect
score < 30            → human
硬判定:≥2 条 high 证据 → bot;1 条 high → suspect
```

阈值集中在 `server/src/scorer.ts` 的 `THRESHOLDS`,权重集中在 `rules.ts`,便于 A/B 调参。

### 可解释性样例

每次评分返回完整证据链,CLI 与报告中形如:

```
HIGH  +22 HEADLESS_UA_STRING   User-Agent 中直接包含 HeadlessChrome 标识
       observed: "Mozilla/5.0 ... HeadlessChrome/159.0 ..."
       expected: 常规 Chrome UA 不含 Headless 字样
HIGH  +14 HEADLESS_WEBDRIVER   navigator.webdriver === true
       observed: true
```

## 对照实验结果(最近一次)

| 场景 | 分组 | 总分 | 判定 |
|---|---|---|---|
| 原生 headless + 标准脚本 | 机器人 | 45 | bot(硬判定) |
| headless + stealth 补丁 | 机器人 | 77 | bot |
| headless + 类人贝塞尔操作 | 机器人 | 45 | bot(环境证据独立成立) |
| headed + 标准 Playwright | 机器人 | 10 | suspect(webdriver) |
| headed + dispatchEvent 合成事件 | 机器人 | 52 | bot |
| headless + 伪装 iPhone UA | 机器人 | 42 | bot(矛盾规则命中) |
| headless + 框架全局变量 | 机器人 | 63 | bot |
| headless 静默 9s 无操作 | 机器人 | 51 | bot |
| headed 类人操作(真人对照) | 真人 | 5 | **human,零误报** |

完整逐规则证据见 `tests/results/comparison-report.md`。

## 不卡页面的工程手段

- 所有事件监听器 `{ passive: true, capture: true }`,绝不阻塞滚动/输入;
- 高频 mousemove 抽样(默认每 2 个取 1)+ 固定容量 RingBuffer,内存有上界;
- Canvas/Audio/字体等重探针放进 `requestIdleCallback`,首帧后才跑;
- 统计聚合只在 flush 时于 idle 回调执行,输入热路径只做 O(1) 入队;
- 上报用 `sendBeacon`(卸载)/ `fetch keepalive`,失败静默;
- 每个探针独立 try/catch,任何 API 被封锁都不影响宿主页面。

## 隐私

键盘只记录**节奏**(时间间隔、code 的 hash、key 长度),从不记录键值;默认不采集任何表单内容。

## 已知边界

- 真人录制/回放依赖有窗口环境;无头 CI 中 HUM-2 自动 skip,类人对照组 HUM-1 由 headed project 承担。
- 规则权重基于当前 Chromium 159 的行为标定;浏览器版本演进后建议用 `test:report` 重新校准。
- 存储为内存 Map,仅用于测试台;生产接入需实现持久化(替换 `server/src/index.ts` 的 store)。
