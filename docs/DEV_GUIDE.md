# KCurve 代码导读（给第一次读的人）

KCurve 是 **一个 3000 多行的 `.jsx` 单文件**，但它不是 3000 行都要读。真正的主线只有
**状态 → 布局 → 绘制 → 命中测试 → 鼠标交互 → 写回关键帧** 这几段；颜色、文字测量、圆角路径
这些是工具箱，第一遍完全可以跳过。

> 下面用 `2.0.0` 的行号做参考；以后加了代码，行号会变，**优先按函数名搜**。

---

## 一、先记住数据模型

整个面板只围绕一个全局对象 `S`：

```js
S = {
  anchors: [
    { x: 0,   y: 0,   hIn: null, hOut: {x, y}, smooth: false },
    { x: 0.5, y: 0.4, hIn: {x,y}, hOut: {x,y}, smooth: true  },
    { x: 1,   y: 1,   hIn: {x,y}, hOut: null,  smooth: false }
  ],
  allowOvershoot, realtime, writeOnRelease,
  userGroups, groupOrder, selectedGroupId,
  presetSide, onlySelectedHandles, ...
}
```

- `x, y` 都在 **0–1 的曲线坐标**里，不是像素。
- `hIn` / `hOut` 是**绝对曲线坐标**，不是相对锚点的偏移。
- 两个锚点 = 单段模式；三个及以上 = 多点模式。
- 首尾锚点永远被 `enforceEndpoints()` 固定在 `(0,0)` / `(1,1)`。
- 屏幕像素由 `drawEditor()` 里的 `mx()` / `my()` 换算，交互里用 `screenToCurve()` 反算。

---

## 二、20 个分区，先看这 6 个

| 分区 | 起始行约 | 作用 | 第一遍 |
|---|---:|---|---|
| 常量 / 工具 / 颜色 / 字体 / 绘制原语 | 71–360 | `clamp`、`finite`、颜色、`roundPath`、`line`… | 跳过 |
| **曲线模型** | 362 | `segmentsOf`、`curveSegmentsFor`、`cubicPointAt`、加点/删点/平滑 | **看** |
| **关键帧缓动** | 636 | `readPairCurve`、`buildActions`、`applyMultiCurve`、`applyCurrent` | **看** |
| **主题 / 状态** | 1129 | `defaultState`、`loadState`、`saveState`、`STATE_VERSION` | **看** |
| 杆限制 / 命中辅助 | 1493 | `clampAnchorHandles`、`hitTest` | 看 `clampAnchorHandles` |
| 模块状态 / 内置预设 | 1541–1726 | `S`、`canvas`、`drag`、`classicPresets` | 扫一眼 |
| **布局** | 1727–2020 | `buildLayout`、`layoutFunction`、`layoutPresets` | **看** |
| **绘制：编辑器** | 2021–2120 | `drawEditor` | **看** |
| 绘制：工具 / 图标 | 2121–2422 | `drawTool`、`drawIcon` | 改图标时看 |
| 绘制：预设 / 菜单 | 2423–2667 | `drawPresets`、`drawMenu` | 改预设时看 |
| 预设操作 | 2668–2877 | `loadPreset`、保存/重命名/删除/拖动 | 改预设时看 |
| 原生对话框 | 2878–2973 | `presetSaveDialog` | 很少改 |
| **命中测试 / 交互** | 2974–3690 | `hitTest`、`canvasMouseDown/Move/Up` | **重点看** |
| 窗口 / 入口 | 3691+ | 面板构建、自旋任务、浮动窗口 | 最后看 |

---

## 三、建议阅读顺序（约 40 分钟）

1. `defaultState`（约 1130）— 先知道有哪些状态。
2. `buildLayout`（约 1731）— 知道编辑器、工具栏、预设区三块矩形怎么算。
3. `drawEditor`（约 2058）— 曲线、杆、点、边界框怎么画。
4. `hitTest`（约 2975）— 鼠标坐标怎么变成“点/杆/按钮/预设”。
5. `canvasMouseDown`（约 3061）+ `canvasMouseMove`（约 3167）— 拖拽的全部逻辑。
6. `applyCurrent`（约 1072）+ `applyMultiCurve`（约 925）+ `readPairCurve`（约 703）— 曲线怎么写回关键帧、怎么读回来。
7. `loadState` / `saveState`（约 1277 / 1466）— 设置怎么持久化。
8. 最后再按需看 `drawIcon`、`drawPresets`、`openSettingsMenu`。

**不要**从第 1 行开始读。前 300 行是绘制原语和颜色转换，读它不会让你更懂 KCurve。

---

## 四、“我想改 X，该去哪”

| 想改的东西 | 找这里 |
|---|---|
| 面板/编辑器/预设区的大小与位置 | `buildLayout`（1731） |
| 工具栏哪些按钮、怎么换行 | `toolControls`（1841）、`layoutFunction`（1868） |
| 工具图标长什么样 | `drawIcon`（2224）；工具列表在 `toolControls` |
| 工具按下反馈 | `drawTool`（2169） |
| 编辑器边框/圆角/背景 | `drawEditor`（2058） |
| 曲线颜色/选中环/杆 | `drawEditor`（2058） |
| 点/杆的命中范围与优先级 | `hitTest`（2975） |
| 拖点、拖杆、拖预设 | `canvasMouseDown`（3061）、`canvasMouseMove`（3167）、`canvasMouseUp`（3303） |
| 杆的范围限制 | `clampAnchorHandles`（1514） |
| 平滑点镜像 | `canvasMouseMove` 里的 `a.smooth` 分支（约 3200） |
| 加点/删点/平滑 | `addAnchor`（531）、`deleteAnchor`（564）、`toggleSmooth`（610） |
| 单段写入 | `buildActions`（772）、`applyCurrent`（1072） |
| 多点写入/重建关键帧 | `applyMultiCurve`（925） |
| 从关键帧读缓动 | `readPairCurve`（703）、`importMultiPoints`（3597） |
| 反转曲线 | `reverseCurve`（3652） |
| 内置预设 | `classicPresets`（1609）及 `BUILTIN_GROUPS` |
| 预设点击/保存/删除/拖动 | `loadPreset`（2669）、`saveCurrentAsPreset`（2717）、`drawPresets`（2458） |
| 设置菜单 | `openSettingsMenu`（2586） |
| 状态迁移/版本 | `STATE_VERSION`、`loadState`（1277）、`migrateClassicPresets` |
| 齿轮旋转/自旋任务 | `startSpinTask`（1582）、`kcurveSpinTick`（1592） |
| 面板入口 | 文件末尾 `buildPanelLauncher` / 窗口分区（3691+） |

---

## 五、调试方式

- 语法：`node --check KCurve.jsx`（先把 `.jsx` 复制成临时 `.js` 也行）。
- UI 只能靠 EffectCraft 跑：改完复制到
  `%APPDATA%\EffectCraft\Scripts\ScriptUI Panels\KCurve.jsx`，**重新打开面板**。
- 没有断点调试器；常用：
  - `st("…")` / `status("…")` 看状态栏；
  - `writeLn(...)` / `$.writeln(...)` 看脚本输出；
  - 临时在 `drawEditor` 里画参考线，或把某段 `continue` 掉。
- 改交互前先看 `hitTest` 返回的 `kind`：`anchor`/`handle`/`tool`/`preset`/`menu`…
- 发布前跑：
  `verify/ease_math_probe.jsx`、`verify/multipoint_probe.jsx`（headless）。

---

## 六、代码风格（改的时候别踩）

- 文件是 **ES3 风格**：`var`、普通函数、没有箭头函数/`let`/`const`，因为跑在 ScriptUI 里。
- 不要用 DOM、`fetch`、`require`；这是宿主脚本，不是网页。
- 坐标都是曲线坐标，**别把像素值直接存进 `S.anchors`**。
- 改 `S` 后一般要 `saveState()`；需要重画就 `redraw()`。
- 写完关键帧后选择会被时间线清掉，需要 `selectKeyIndices()` 恢复。
- 多点写入会重建关键帧，优先看 `applyMultiCurve` 的“快速路径 / 重建路径”。

---

## 七、想更细的注释？

可以按函数单独加“为什么这么写”的注释。最值得加注释的是：

1. `clampAnchorHandles` 的段内 x 限制；
2. `readPairCurve` 为什么不能钳制相对 y；
3. `applyMultiCurve` 的快路径与选择恢复；
4. `canvasMouseMove` 平滑杆固定长度的原因；
5. `importMultiPoints` 为什么先开 Overshoot 再 clamp。

这些地方现在的注释已经写了“是什么”，但可以再补“为什么”。
