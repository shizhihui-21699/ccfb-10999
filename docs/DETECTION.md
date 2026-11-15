# 技术细节:检测信号与阈值依据

本文记录每条规则背后的实测数据,以便后续维护者判断阈值是"调出来的"还是"猜出来的"。原始数据由 `npm run harness` + `npm run bench` + `node harness/calibrate.ts` 生成,汇总在 `data/calibration.json`。

## 一、探针发现(设计依据)

两轮探针(`harness/probe.ts`、`probe2.ts`)在各启动方式下采集约 80 项属性,主要结论:

| 属性 | headless shell | 新 headless(`channel:'chromium'`) | 真实 Chrome(headed) |
|---|---|---|---|
| `navigator.webdriver` | true | true | **false** |
| `plugins.length` | **0** | 5 | 5 |
| `pdfViewerEnabled` | **false** | true | true |
| `window.chrome` | **null** | 完整 | 完整 |
| WebGL renderer | **SwiftShader** | Apple M4 Max | Apple M4 Max |
| UA 含 `HeadlessChrome` | **是** | **是** | 否 |
| `outerHeight - innerHeight` | **0** | **0** | 87 |
| `Notification.permission` | **denied** | default | default |

注:真实 Chrome 通过 CDP 连接时 `webdriver=true`,所以它不能作人类基线(见下文)。

### 1.1 `isTrusted` 不是自动化判据

Playwright 的 `page.mouse.*`、`page.keyboard.*` 通过 CDP `Input.dispatch*` 注入,页面里测得:

```
pointermove  isTrusted=true  pointerType=mouse
mousedown    isTrusted=true
keydown      isTrusted=true
```

**全部为 true。** 因此不能用 `isTrusted` 判断"是否自动化",它只能识别 `dispatchEvent` 这类脚本伪造事件(这类为 false)。系统把它放在低权重的完整性族,不承担主要判定。

### 1.2 stealth 补丁的固有破绽

删除 `navigator.webdriver` 这类常见伪装会留下痕迹。实测对比:

| 检查项 | 原生 Chrome | 打了 stealth 补丁 |
|---|---|---|
| `Object.getOwnPropertyDescriptor(navigator,'webdriver')` | undefined | **存在**(自有属性) |
| 该 getter 的 `toString()` | `function get webdriver() { [native code] }` | **无 `[native code]`** |
| 原型链上的 `webdriver` | 存在 | 存在(未删,只覆盖了实例) |

原生实现位于 `Navigator.prototype`,实例上没有自有属性。任何 `Object.defineProperty(navigator, ...)` 都会破坏这一点。这是引擎 `auto.webdriver-deleted` / `auto.nav-tampered` / `auto.non-native` 三条规则的依据。

### 1.3 触摸接触时长是物理约束

CDP `Input.dispatchTouchEvent` 的 touchStart 与 touchEnd 可以相邻发出。实测合成点击的接触时长:

| 生成方式 | 接触时长 |
|---|---|
| CDP `touchStart` → 立即 `touchEnd` | 0.1 – 14 ms |
| `page.touchscreen.tap` | ~0.4 ms |

真实手指触碰玻璃的接触时长通常 > 60 ms。引擎阈值取 35 ms,留出充分余量。

## 二、行为阈值与真人分布

从 18 个 OS 级输入会话(12 个正常节奏 + 6 个偏快)统计:

| 指标 | 真人最小值 | 真人中位 | 真人最大值 | 触发阈值 | 自动化实测 |
|---|---|---|---|---|---|
| 轨迹直线度 straightness | 0.765 | 0.775 | 0.795 | **> 0.999** | 0.90 – 1.00 |
| 段长变异 segCV | 0.550 | 0.578 | 0.590 | **< 0.02** | 0.00 – 1.26 |
| 方向变化率 dirRate | 0.257 | 0.357 | 0.429 | **< 0.02** | 0.00 – 0.13 |
| 点击按下时长 | 75 ms | 94 ms | 100 ms | **< 25 ms** | 0.2 – 14 ms |
| 按键间隔中位 | 100 ms | 178 ms | 244 ms | **< 12 ms** | 0.0 – 0.3 ms |
| 按键间隔 CV | 0.405 | 0.581 | 0.819 | **< 0.15** | 0.02 – 0.22 |
| 按键按下时长 CV | 0.143 | 0.410 | 0.502 | **< 0.06 (n≥8)** | 0.07 |
| 首次点击延迟 | 1767 ms | 2025 ms | 2072 ms | **< 20 ms** | 14 ms |
| 非物理瞬移次数 | 0 | 0 | 0 | **> 0** | 见下 |

关键点:**每一条阈值与真人实测区间都有明显间隔**,不是擦边。直线度阈值 0.999 与真人上界 0.795 之间有 0.2 的空隙。

### 2.1 被删除的规则(反面记录)

有三条规则在实测中被证伪并删除,记录在此避免被重新引入:

1. **`mouse.integer-coords`(坐标为整数)**。最初认为人类设备产生亚像素坐标。实测 OS 鼠标在 macOS 上**全部是整数坐标**(坐标按点量化),于是这条规则 100% 误报真人。删除。
2. **`mouse.instant-interaction`,以首次 `pointermove` 计时**。当用户的光标本来就停在页面上时,加载瞬间就会触发一次 `pointermove`,此时点击仍在 2 秒后。改为只以**首次点击**计时(真人实测 ≥1767ms)。
3. **`kb.dwell-constant` 早期版本(n≥5, CV<0.1)**。真人样本中出现 CV=0.087 触发误报。收紧为 n≥8 且 CV<0.06;同时把行为类证据的单独升级线从 35 分提高到 55 分。

### 2.2 瞬移检测的设计

合成输入的典型轨迹:

```
(540,248) t=1ms      ← OS 光标当前所在位置
(200,200) t=16ms     ← 脚本直接跳到目标起点,15ms 内移动 340px ≈ 22,667 px/s
(216,209) t=22ms     ← 之后是均匀插值
...
```

单看这次跳变,22,667 px/s 还不足以断言非物理(高端鼠标快速甩动可达 15,000 px/s)。因此采用两条措施:

1. **把不连续点当作轨迹断开**而非位移。这修正了一个真实缺陷:先前把 340px 跳变计入路径长度,使 `ua-spoof` 的直线度显示为 0.24(被稀释),修正后正确显示为 **1.000**。
2. 只有速度 ≥20,000 px/s **且**单步 ≥60px 才计入 `teleportations`。

真人 18 次采样的 `teleportations` 恒为 0。

## 三、家族聚合与决策分层

### 3.1 封顶

单一家族封顶,防止 20 条弱规则堆出一个假高分:

```
自动化 100 / 矛盾 100 / 完整性 60 / 鼠标 80 / 键盘 70 / 触摸 50
```

例如 `naive-bot` 的自动化族原始分达 235,封顶后为 100。

### 3.2 饱和聚合

```
total = f1 + 0.55·f2 + 0.30·f3 + 0.17·f4 + ...
```

按家族分数降序。效果:一个 100 分的家族单独就能定性;而两个 30 分的家族合计 46.5,不会因为"数量多"就达到 block。

### 3.3 决策分层

```
确定性证据存在 ──┬─ 确定性命中 ≥2 或总分 ≥70 → block
                └─ 否则                     → challenge
仅行为证据     ──┬─ 总分 ≥55                 → challenge
                └─ 否则                     → allow
其它(环境证据)  ──┬─ 总分 ≥70                 → block
                └─ 总分 ≥35                 → challenge
```

"仅行为证据不得 block"是硬约束:轨迹和打字节奏本质是统计量,再强的统计倾向也不应直接封禁真实用户。

## 四、已知检测盲区

`ua-spoof`(真实 Chrome 仅改 UA)在**全环境清洗**的消融版本中降到 25 分 `allow`。这是真实存在的盲区,成因:

- 该场景的浏览器是真实的,插件、WebGL、字体、几何都真;
- 唯一的自动化痕迹是 `webdriver=true`,而它可被一行 `defineProperty` 抹掉(抹除后又会触发篡改规则,但那是另一层面的对抗);
- 其轨迹只有 17 个点,跨越一次大跳变后是一段几乎完美的直线,直线度修正后为 1.000,触发 `mouse.perfect-straight`(55)与 `mouse.teleport`(45),鼠标族封顶 80 —— 但在消融版中被一并清洗后仅剩 25。

结论:**纯统计特征对"环境完美 + 轨迹中等质量"的攻击不是决定性的**。真实生产环境需要叠加设备信誉、频次、业务规则(如同一手机号/设备短时间多次领券),这些不在本仓库范围内。

## 五、复现

```bash
npm run build
bash harness/native/build.sh     # 需 macOS + 辅助功能权限
npm run harness                  # 采集
npm run bench                    # 误报/检出统计
npm run ablate                   # 消融
node harness/calibrate.ts        # 重新生成阈值依据
npm run perf                     # 性能
```

`harness/native` 仅用于本地对照实验,生产部署不包含。
