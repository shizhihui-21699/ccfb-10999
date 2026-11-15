# BotGuard 对照实验报告

生成时间:2026-11-15T17:42:42.753Z

| 场景 | 分组 | 总分 | 判定 | 无头(≤45) | 自动化(≤30) | 矛盾(≤20) | 行为(≤20) | 命中规则数 |
|---|---|---|---|---|---|---|---|---|
| S1 原生 headless + 标准脚本 | 机器人 | 45 | **bot** | 45 | 0 | 0 | 0 | 7 |
| S2 headless + stealth 补丁 | 机器人 | 77 | **bot** | 42 | 30 | 5 | 0 | 8 |
| S3 headless + 类人贝塞尔操作 | 机器人 | 45 | **bot** | 45 | 0 | 0 | 0 | 9 |
| S4 headed + 标准 Playwright 操作 | 机器人 | 10 | **suspect** | 10 | 0 | 0 | 0 | 2 |
| S5 headed + dispatchEvent 合成事件 | 机器人 | 52 | **bot** | 10 | 30 | 0 | 12 | 7 |
| S6 headless + 伪装 iPhone UA | 机器人 | 42 | **bot** | 28 | 0 | 14 | 0 | 4 |
| S7 headless + 自动化框架全局变量 | 机器人 | 63 | **bot** | 45 | 18 | 0 | 0 | 9 |
| S8 headless 静默无操作 9s | 机器人 | 51 | **bot** | 45 | 0 | 0 | 6 | 8 |
| H1 headed 类人操作 + 隐藏 webdriver(对照) | 真人 | 5 | **human** | 0 | 0 | 5 | 0 | 5 |

## 逐场景证据解释

### S1 原生 headless + 标准脚本 → BOT (45 分)
- **无头浏览器特征**(贡献 45/45)
  - `HEADLESS_UA_STRING` +22 — User-Agent 中直接包含 HeadlessChrome 标识
    - observed: `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36"`
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_MISSING_CHROME` +8 — Chromium 系 UA 却没有 window.chrome 对象(新版无头模式特征)
    - observed: `{"ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/","hasWindowChrome":false}`
  - `HEADLESS_OUTER_INNER_ZERO` +6 — window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框
    - observed: `0`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
  - `HEADLESS_PLUGINS_EMPTY` +4 — 桌面 Chromium 的 navigator.plugins 为空
    - observed: `[]`

### S2 headless + stealth 补丁 → BOT (77 分)
- **无头浏览器特征**(贡献 42/45)
  - `HEADLESS_UA_STRING` +22 — User-Agent 中直接包含 HeadlessChrome 标识
    - observed: `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36"`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_OUTER_INNER_ZERO` +6 — window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框
    - observed: `0`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
- **自动化框架痕迹**(贡献 30/30)
  - `AUTO_GLOBALS_LEAK` +18 — 全局作用域存在自动化框架注入变量(puppeteer/playwright/selenium 等)
    - observed: `["__playwright_stealth__"]`
  - `AUTO_NATIVE_TAMPERED` +9 — 浏览器核心原生函数的 toString 不含 [native code],已被脚本 hook/替换
    - observed: `["navigator.permissions.query"]`
  - `AUTO_WEBDRIVER_GETTER_PATCH` +4 — 仅 navigator.webdriver 的 getter 被替换为非原生函数(轻度反检测补丁)
    - observed: `["navigator.webdriver"]`
- **环境信号矛盾**(贡献 5/20)
  - `CONTRA_WEBDRIVER_HIDDEN_BADLY` +5 — webdriver 被改成 false,但 Navigator.prototype 上的 getter 已非原生(补丁式伪装痕迹;隐私工具也可能触发,仅作佐证)
    - observed: `["navigator.webdriver"]`

### S3 headless + 类人贝塞尔操作 → BOT (45 分)
- **无头浏览器特征**(贡献 45/45)
  - `HEADLESS_UA_STRING` +22 — User-Agent 中直接包含 HeadlessChrome 标识
    - observed: `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36"`
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_MISSING_CHROME` +8 — Chromium 系 UA 却没有 window.chrome 对象(新版无头模式特征)
    - observed: `{"ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/","hasWindowChrome":false}`
  - `HEADLESS_OUTER_INNER_ZERO` +6 — window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框
    - observed: `0`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
  - `HEADLESS_PLUGINS_EMPTY` +4 — 桌面 Chromium 的 navigator.plugins 为空
    - observed: `[]`
- **自动化框架痕迹**(贡献 0/30)
  - `AUTO_HUMAN_TRUSTED_EVENTS` -5 — 采集到足量 isTrusted=true 的输入事件,说明存在真实输入设备
    - observed: `{"total":70,"trusted":70}`
- **行为异常**(贡献 0/20)
  - `BEH_HUMAN_RHYTHM` -6 — 打字节奏呈现人类特征:高变异且均值在真人区间
    - observed: `{"cv":0.471,"mean":169.4,"dwell":1}`
- 人类信号:AUTO_HUMAN_TRUSTED_EVENTS(-5), BEH_HUMAN_RHYTHM(-6)

### S4 headed + 标准 Playwright 操作 → SUSPECT (10 分)
- **无头浏览器特征**(贡献 10/45)
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_HUMAN_GL` -4 — 检测到真实硬件 GPU 渲染器,降低无头嫌疑
    - observed: `"Google Inc. (Apple) ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)"`
- 人类信号:HEADLESS_HUMAN_GL(-4)

### S5 headed + dispatchEvent 合成事件 → BOT (52 分)
- **无头浏览器特征**(贡献 10/45)
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_HUMAN_GL` -4 — 检测到真实硬件 GPU 渲染器,降低无头嫌疑
    - observed: `"Google Inc. (Apple) ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)"`
- **自动化框架痕迹**(贡献 30/30)
  - `AUTO_MOUSE_UNTRUSTED` +16 — 鼠标事件 isTrusted=false,由 dispatchEvent 合成而非真实输入设备
    - observed: `{"ratio":1,"count":20}`
  - `AUTO_CLICK_UNTRUSTED` +10 — 点击事件 isTrusted=false
    - observed: `{"ratio":1,"count":8}`
  - `AUTO_SCROLL_UNTRUSTED` +8 — 滚动事件 isTrusted=false,由 scrollTo/scrollIntoView 触发
    - observed: `{"ratio":0.89,"count":9}`
- **行为异常**(贡献 12/20)
  - `BEH_CLICK_DUPLICATE_SPAM` +6 — 多次点击落在完全相同的像素坐标,脚本定点重复点击
    - observed: `{"ratio":0.86,"count":8}`
  - `BEH_SCROLL_UNIFORM` +6 — 滚动增量完全一致,wheel 事件由脚本以固定步长派发
    - observed: `{"ratio":0.86,"count":9}`
- 人类信号:HEADLESS_HUMAN_GL(-4)

### S6 headless + 伪装 iPhone UA → BOT (42 分)
- **无头浏览器特征**(贡献 28/45)
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
- **环境信号矛盾**(贡献 14/20)
  - `CONTRA_MOBILE_UA_NO_TOUCH` +14 — UA 声称是移动设备,但 maxTouchPoints=0 且无 coarse pointer
    - observed: `{"ua":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Apple","maxTouchPoints":0,"coarse":false}`

### S7 headless + 自动化框架全局变量 → BOT (63 分)
- **无头浏览器特征**(贡献 45/45)
  - `HEADLESS_UA_STRING` +22 — User-Agent 中直接包含 HeadlessChrome 标识
    - observed: `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36"`
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_CDC_VARS` +12 — window/document 上存在 ChromeDriver 注入的 cdc_ 变量
    - observed: `["$chrome_asyncScriptInfo"]`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_MISSING_CHROME` +8 — Chromium 系 UA 却没有 window.chrome 对象(新版无头模式特征)
    - observed: `{"ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/","hasWindowChrome":false}`
  - `HEADLESS_OUTER_INNER_ZERO` +6 — window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框
    - observed: `0`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
  - `HEADLESS_PLUGINS_EMPTY` +4 — 桌面 Chromium 的 navigator.plugins 为空
    - observed: `[]`
- **自动化框架痕迹**(贡献 18/30)
  - `AUTO_GLOBALS_LEAK` +18 — 全局作用域存在自动化框架注入变量(puppeteer/playwright/selenium 等)
    - observed: `["callSelenium","__nightmare"]`

### S8 headless 静默无操作 9s → BOT (51 分)
- **无头浏览器特征**(贡献 45/45)
  - `HEADLESS_UA_STRING` +22 — User-Agent 中直接包含 HeadlessChrome 标识
    - observed: `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36"`
  - `HEADLESS_WEBDRIVER` +14 — navigator.webdriver === true,浏览器正被 WebDriver 协议控制
    - observed: `true`
  - `HEADLESS_SWIFTSHADER` +10 — WebGL 使用 SwiftShader/软件渲染,无头环境典型特征
    - observed: `"Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)"`
  - `HEADLESS_MISSING_CHROME` +8 — Chromium 系 UA 却没有 window.chrome 对象(新版无头模式特征)
    - observed: `{"ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/","hasWindowChrome":false}`
  - `HEADLESS_OUTER_INNER_ZERO` +6 — window.outerWidth 与 innerWidth 差值为 0,缺少真实浏览器窗口边框
    - observed: `0`
  - `HEADLESS_NOTIF_DENIED` +4 — Notification 权限默认 denied,无头 Chrome 的默认行为
    - observed: `"denied"`
  - `HEADLESS_PLUGINS_EMPTY` +4 — 桌面 Chromium 的 navigator.plugins 为空
    - observed: `[]`
- **行为异常**(贡献 6/20)
  - `BEH_NO_INPUT_LONG_SESSION` +6 — 会话超过 8 秒却没有任何鼠标/键盘/滚动输入,典型无头脚本静默跑流程
    - observed: `{"duration":10207,"total":0}`

### H1 headed 类人操作 + 隐藏 webdriver(对照) → HUMAN (5 分)
- **无头浏览器特征**(贡献 0/45)
  - `HEADLESS_HUMAN_GL` -4 — 检测到真实硬件 GPU 渲染器,降低无头嫌疑
    - observed: `"Google Inc. (Apple) ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)"`
- **自动化框架痕迹**(贡献 0/30)
  - `AUTO_WEBDRIVER_GETTER_PATCH` +4 — 仅 navigator.webdriver 的 getter 被替换为非原生函数(轻度反检测补丁)
    - observed: `["navigator.webdriver"]`
  - `AUTO_HUMAN_TRUSTED_EVENTS` -5 — 采集到足量 isTrusted=true 的输入事件,说明存在真实输入设备
    - observed: `{"total":79,"trusted":79}`
- **环境信号矛盾**(贡献 5/20)
  - `CONTRA_WEBDRIVER_HIDDEN_BADLY` +5 — webdriver 被改成 false,但 Navigator.prototype 上的 getter 已非原生(补丁式伪装痕迹;隐私工具也可能触发,仅作佐证)
    - observed: `["navigator.webdriver"]`
- **行为异常**(贡献 0/20)
  - `BEH_HUMAN_RHYTHM` -6 — 打字节奏呈现人类特征:高变异且均值在真人区间
    - observed: `{"cv":0.537,"mean":162.7,"dwell":1}`
- 人类信号:HEADLESS_HUMAN_GL(-4), AUTO_HUMAN_TRUSTED_EVENTS(-5), BEH_HUMAN_RHYTHM(-6)