# KCurve 可行性验证与 EffectCraft 脚本 API 速查

验证环境：EffectCraft 0.13.0（`app.version` = `26.0 (EffectCraft 0.13.0)`），Windows，
脚本通过 live app（`effectcraft --control 9877` + MCP bridge）和 headless CLI 实测。

> 2026-10-28：在 EffectCraft **0.17.0**（`effectcraft-cli info` → `"version":"0.17.0"`）上重新
> 跑过 easing 数学验证、多点写入/选中恢复和实时写入的 UI 端到端验证（见 §8 末尾）。
> 本文件其余结论仍来自 0.13.0，若行为不一致以 0.17.0 的实测记录为准。
>
> 2026-10-31：在 EffectCraft **0.19.0**（`app.version` = `26.0 (EffectCraft 0.19.0)`）上复测了
> 停靠面板尺寸（§6）和鼠标拖拽（§7）；0.19.0 修复了这两个限制（上游 #2585 / #2584），
> KCurve 1.1.1 已适配（§8.13）。0.13–0.18 的旧结论仍然成立，脚本会自动退回旧行为。

**结论：可行。** 做 AE Flow 类缓动面板需要的核心能力都在：

- ScriptUI 自定义绘制 + 鼠标拖拽 + `onDraw` 重绘；
- 读取当前选中关键帧（`comp.selectedProperties` / `Property.selectedKeys`）；
- 读写关键帧缓动（`keyInTemporalEase` / `keyOutTemporalEase` / `setTemporalEaseAtKey`）；
- `app.settings` 持久化预设 JSON；
- 可缩放的自定义面板（浮动画布可以自己拖边缩放）。

旧的平台限制（**停靠面板拿不到实际尺寸**）在 0.19.0 已修复；0.13–0.18 仍需固定尺寸，详见 §6。

---

## 1. 运行脚本

```powershell
# 在 live app 中运行一个 .jsx 文件（窗口会留在 app 里）
& 'C:\Program Files\EffectCraft\effectcraft-cli.exe' script 'D:\path\KCurve.jsx' --bridge 9877 --json

# headless（没有窗口，脚本里的 palette 不会显示；适合纯逻辑测试）
& 'C:\Program Files\EffectCraft\effectcraft-cli.exe' script test.jsx --demo --json
```

GUI 里也可以：`File ▸ Scripts ▸ Run Script File…`，或安装后在 `File ▸ Scripts` 里运行。
安装成 ScriptUI Panel：

```text
file.installScriptUIPanel {path:"D:\\...\\KCurve.jsx"}   # 复制到配置目录 Scripts/ScriptUI Panels
window.scriptPanel {name:"KCurve.jsx"}                   # 以停靠面板打开（有上述尺寸限制）
```

`EFFECTCRAFT_CONFIG_DIR` 可以改写配置目录；用 workspace 里的配置目录时，脚本设置会写到
`<config>/script_settings.json`。

## 2. ScriptUI 能力（0.13 实测）

支持：`panel`, `group`, `button`, `statictext`, `edittext`, `checkbox`, `radiobutton`,
`slider`, `scrollbar`, `progressbar`, `dropdownlist`, `listbox`, `tabbedpanel`, `image`；
`onDraw` + `ScriptUIGraphics`；鼠标事件 `mousedown` / `mouseup` / `mousemove` /
`mouseover` / `mouseout` / `click`，支持 `addEventListener` 冒泡/捕获、`stopPropagation()`；
`app.settings`；`window.show()/close()`；`window.layout.layout(true)`。

### 2.1 自定义画布

```js
var win = new Window("palette", "My Panel", undefined, { resizeable: true });
win.orientation = "stack";            // 关键：stack 才会让子 panel 双向 fill
win.alignChildren = ["fill", "fill"];
win.margins = 0;
win.spacing = 0;
win.size = [560, 760];
var canvas = win.add("panel", undefined, undefined, { name: "canvas" });
canvas.alignment = ["fill", "fill"];
canvas.onDraw = function () {
  var g = this.graphics, w = this.size.width, h = this.size.height;
  g.newPath(); g.rectPath(0, 0, w, h);
  g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.02, 0.025, 0.035, 1]));
};
canvas.addEventListener("mousedown", function (e) {
  // e.clientX / e.clientY 相对 canvas；e.button: 0 左, 2 右; e.detail 点击次数
});
win.show();
win.layout.layout(true);
canvas.notify("onDraw");              // 重绘画布
```

注意：

- **根窗口自己的 `onDraw` 不会画出来**（画树只绘制子控件）。所有自定义绘制放在子 `panel` 上。
- 窗口 `orientation = "stack"` + 子控件 `alignment = ["fill","fill"]` 才能让画布填满窗口；
  纵向 `column` 布局里子控件高度只取 preferredSize，不会 fill（0.13 的布局实现如此）。
- 脚本里改 `win.size = [w, h]` 后调用 `win.layout.layout(true)` + `canvas.notify("onDraw")`
  就能真正改变 floating 窗口尺寸（已验证）。因此“拖边缘缩放”可以由脚本自己实现。
- `notify("onDraw")` 是刷新画布的方式；`onDraw` 里的绘制会记成 draw list，宿主再绘制。

### 2.2 绘图 API 细节

- `g.newFont` **不存在**；用 `ScriptUI.newFont(name, style, size)` 得到字体对象。
- `g.font = font` + `g.drawString(text, pen, x, y)`；`g.measureString(text, font)` 可用。
- 宿主实际使用 app 的 UI 字体绘制文本，**family 和 bold 样式不会生效，只有字号会生效**
  （`scriptui_view.rs` 里用 `Tokens::ui(size)`）。所以层级用字号和颜色表达。
- `Path` 只有 `moveTo` / `lineTo` / `rectPath` / `ellipsePath` / `closePath` 等；
  **没有 `cubicTo` / `curveTo`**。圆角矩形用多段折线近似（每角 6 段就够）。
- 颜色是 0–1 RGBA，但**颜色空间随版本不同**（0.19.0 上游 #2272）：
  - 0.19.0 起按普通 **sRGB** 显示：传 `v / 255` 就得到 `#RRGGBB` 本身；
  - 0.13–0.18 按**线性光**处理再套 sRGB 曲线（偏亮）：要得到同一个 `#RRGGBB`，先做
    sRGB → linear 转换再传。
  实测 0.19.0 传 `#2B2B2B`、`#D8D8D8`、`#F28C28`、`#A8C7FA`、`#737379`、`#060607`
  全部逐字节等于源 hex；旧版传 `#A8C7FA` 的线性值 `(0.393,0.571,0.949)` 显示为 `#A8C7FA`。
- 填充 `g.fillPath(path, brush)`，描边 `g.strokePath(path, pen)`（两个参数均可）。
- 文本坐标是左上角对齐（宿主 `Align2::LEFT_TOP`）。

### 2.3 鼠标 / 尺寸

- 鼠标事件：0.13–0.18 只有画布范围内有事件，拖出窗口会丢 move；0.19.0 起按下后的
  mousemove/mouseup 会继续送到按下的控件（含坐标越界），见 §7。
- 右键用 `mousedown` 的 `e.button === 2` 处理；`click` 事件由 mousedown+mouseup 产生。
- 画布尺寸用 `this.size`（onDraw 里）读取；窗口尺寸用 `win.size`。
- 滚轮事件未在支持列表里；自定义列表滚动用拖动/点击滚动条实现。

## 3. 关键帧与缓动

### 3.1 选中状态

```js
var comp = app.project.activeItem;
var props = comp.selectedProperties;      // 选中关键帧所在的 Property 数组
for (var i = 0; i < props.length; i++) {
  var p = props[i];
  var keys = p.selectedKeys;              // 选中的关键帧下标（1-based，升序）
}
```

实测：用引擎命令 `keys.select` 选中关键帧后，脚本里马上能读到
`comp.selectedProperties.length === 1`、`property.selectedKeys === [1,2]`。
设置 `property.selectedKeys = [...]` 不生效（实测仍为空）；**读可以，写要用命令
`app.run("keys.select", {keys:[...]})`**（脚本可以调用引擎命令，但 `scriptui.*` 被禁止）。

读取选中关键帧的详细信息也可以用：

```js
app.run("editor.state", {}).selected_keys   // [{layer, prop, time(ticks)}]
app.run("keys.info", {})                   // 选中键的 in/out、inEase/outEase、dims...
```

### 3.2 读写缓动（AE 兼容 API，实测可用）

```js
var p = comp.layer("Tagline").property("ADBE Transform Group").property("ADBE Opacity");
p.keyTime(1);                       // 关键帧时间（comp 秒；见下文时长换算）
p.keyValue(1);
p.keyInInterpolationType(1);        // 6612 Linear / 6613 Bezier / 6614 Hold
p.keyOutInterpolationType(1);
p.keyInTemporalEase(1);             // [{speed, influence}]，每个维度一项
p.keyOutTemporalEase(1);
p.keyTemporalContinuous(1);
p.setTemporalContinuousAtKey(1, false);
p.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
p.setTemporalEaseAtKey(1,
  [new KeyframeEase(inSpeed, inInfluence)],
  [new KeyframeEase(outSpeed, outInfluence)]);
```

- `influence` 是段长的百分比（0.1–100）。
- `speed` 是**绝对速度**（值单位/秒），与 AE 的 Keyframe Velocity 一致。
- 官方 Ease Presets 用“相对段平均速度”的 speed（1 = 匀速）；换算：
  `absoluteSpeed = relativeSpeed * averageSpeed`，`averageSpeed = (v1 - v0) / duration`。
- 时长按官方做法：`dur = (keyTime(a+1) - keyTime(a)) * 100 / layer.stretch`。
  `keyTime` 在本宿主里是 comp 时间，`stretch` 修正后得到缓动使用的层时间。
- 多维度属性：`keyInTemporalEase` 每个维度一项；官方给每个维度算各自的 average speed。
- **Position 是 ThreeD_SPATIAL**：每个键只有一个 temporal ease，速度沿**运动路径长度**，
  不是逐维度。`slopes()` 里对空间属性用 `pathLength(...)/dur`，只传一个 `KeyframeEase`。
  如果错误地逐维度传 ease 数组，宿主会静默只保留第一个，误差可达 ~4%（本环境实测）。
- `influence` 必须在 **0.1–100**，宿主不会自动 clamp（越界直接抛错）；
  `speed` 不限制大小（±1e6 可存，Infinity 会静默变 0，NaN 抛错）。
  KCurve 把 influence clamp 到 0.1–100，相对速度 clamp 到 ±1e6，并在写之前替换非有限值。
- x1=0 / x2=1 不能精确表示（influence 0 被拒绝）：KCurve 用 0.001/0.999 近似，
  但速度用真实的 `y1/x1'` / `(1-y2)/(1-x2')` 计算，误差约 2.4e-3（归一化）。
- 连续键改缓动前要 `setTemporalContinuousAtKey(k, false)`，否则两侧仍被约束；
  如果存在 `setTemporalAutoBezierAtKey`，也设成 false。
- Roving 关键帧会跳过（它的速度是直通的，设缓动不生效）。

### 3.3 关键帧侧与 cubic-bezier 的换算（实测验证）

一段关键帧 a → a+1 的缓动，用 out 侧（a 的出手柄）和 in 侧（a+1 的入手柄）描述。
令 `x1 = outInfluence/100`，`x2 = 1 - inInfluence/100`，`relOut = outSpeed / avgSpeed`，
`relIn = inSpeed / avgSpeed`，则：

```text
y1 = relOut * x1
y2 = 1 - relIn * (1 - x2)
```

反过来（把 cubic-bezier 写到关键帧）：

```text
outInfluence = clamp(x1 * 100, 0.1, 100)
outRelSpeed  = clamp(y1 / x1, -100, 100)
inInfluence  = clamp((1 - x2) * 100, 0.1, 100)
inRelSpeed   = clamp((1 - y2) / (1 - x2), -100, 100)
```

实测：`cubic-bezier(0.42, 0, 0.58, 1)` → influence 42/42、speed 0/0；在 0–100 的
Opacity 段上采样：t=0.2→8.166，0.4→33.188，0.5→50.000，0.6→66.812，0.8→91.834，
与标准 CSS 缓动曲线一致（max error < 1e-3）。

x1=0 或 x2=1 的垂直切线，`y1/x1` 会发散：官方做法是 influence 最小 0.1、相对速度
限制在 ±100；KCurve 采用同样的 clamp，并在状态栏提示。

### 3.4 读回曲线（关键帧 → 编辑器）

取一对相邻选中关键帧 a、a+1：

```js
var outEase = p.keyOutTemporalEase(a);     // 出手柄
var inEase  = p.keyInTemporalEase(a+1);    // 入手柄
var s = slopes(p, a);                      // 官方算法：每维平均速度
var d = 主导维度（|s| 最大）
var x1 = outEase[d].influence / 100;
var y1 = (outEase[d].speed / s[d]) * x1;
var x2 = 1 - inEase[d].influence / 100;
var y2 = 1 - (inEase[d].speed / s[d]) * (1 - x2);
```

多选多组时 KCurve 取所有相邻组的结果做平均（在源码注释中说明）。单组是精确值。

### 3.5 应用策略（KCurve）

- 选中 ≥2 个相邻键：按顺序把曲线的第 k 段映射到第 k 个相邻键对；多段曲线因此可以
  一次写成多组关键帧（多出的键对复用最后一段，多出的曲线段忽略）。
- 单个选中键：出侧用第一段的控制点，入侧用最后一段的控制点（与官方 Ease Presets 的
  In/Out/In-Out 语义一致）。
- 模式：入 / 出 / 入-出；Roving、Hold 侧跳过并在状态里报数。
- 所有写入包在一个 `app.beginUndoGroup("KCurve: Apply Easing")` 里；实时拖拽时
  从 mousedown 到 mouseup 是一个 undo 步骤。

## 4. 持久化

脚本不能写文件（默认 `Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files…`
关闭；`File` 写入会抛错）。`Folder.temp` 也不可用。因此预设存到 `app.settings`：

```js
app.settings.saveSetting("KCurve", "state", JSON.stringify(state));
app.settings.haveSetting("KCurve", "state");
JSON.parse(app.settings.getSetting("KCurve", "state"));
```

实测写入 `<config>/script_settings.json`：

```json
{ "KCurve": { "state": "{\"version\":1,...}" } }
```

官方 Ease Presets 也用同样的方式（section `Ease Presets`, key `userPresets`）。
这意味着预设是**应用级**的、不随 `.ecproj` 项目文件走；项目换掉后预设仍在。
（若以后版本允许脚本写项目目录，可再加一份项目内 JSON。）

## 5. 跟随 EffectCraft 主题

```js
var theme = app.run("prefs.get", { key: "appearance.theme" }); // 返回字符串 "dark" / "darker" / "light"
```

注意：带 `key` 的 `prefs.get` 返回**值本身**（字符串），不是 `{theme: ...}` 对象。
`appearance` 里还有 `appearanceMode`, `darkTheme`, `lightTheme`, `uiScale`。
KCurve 在打开时和每次 mousedown 时读取，切换 dark/light 两套 Material 3 配色。
`app.scheduleTask` 在 live 脚本窗口里实测没有回调（0.13 构建），所以不用定时轮询。

## 6. 平台限制：停靠 ScriptUI 面板拿不到实际尺寸

`crates/ui-egui/src/panels/scriptui_view.rs::panel()` 的做法：

1. 克隆脚本窗口，把 `root.fixed_bounds` 设为停靠区域的实际大小；
2. 在宿主侧 `layout()` 后按实际大小绘制子控件；
3. 但脚本侧自己的 `window` 对象没有收到新的 bounds —— `onDraw` 是在脚本侧按
   **preferredSize** 生成 draw list 的（`scriptui_view.rs` 只读取 `w.draw` 的 op 列表）。

实测：`window.scriptPanel` 打开一个 preferred 320×520 的面板，停靠实际区域是
300×292；`onDraw` 里始终读到 320×520，宿主还会出现 ScrollArea 滚动条。
`scriptui.get` 也只返回脚本侧 320×520。`onResizing` / `onResize` 不会带实际尺寸。

因此：**可缩放的曲线编辑器必须做成 floating Window**（`new Window("palette", …)`），
用脚本自己处理右/下边缘拖拽并改 `win.size`。KCurve 的 File ▸ Scripts 版本就是这么做的。
0.98.1 另外提供了一个**固定 440×700 的停靠面板**：它直接在这个尺寸下绘制，不接受脚本内
缩放；停靠区域更小时宿主会用 ScrollArea 滚动，更大时保留固定画布。两条路径共用同一套
layout/draw 代码，但停靠面板不能自适应实际尺寸。

**0.17.0 复测（2026-10-29）**：限制仍在。停靠面板里 `panel.size` = preferredSize
340×530，`panel.__lb` = `[0,0,340,530]`，`__ub` = null；宿主 `ui.elements` 显示真实
停靠矩形 `panel.ScriptPanel(2)` = **240×476.55**，而脚本画布 `scriptui.2.1` 仍是
340×530。`onResize` / `onResizing` 成员存在，但切换 workspace 也不会触发。
脚本也**不能**读宿主的 `ui.elements`：`app.run("ui.elements", {})` 报
`unknown command`，`app.run("scriptui.list", {})` 返回空数组。所以“自适应停靠尺寸”
在 0.17.0 仍然做不到；只能固定尺寸（或者由用户自己挑一个合适的值）。

**0.19.0 复测（2026-10-31）：已修复（上游 #2585 / PR #2629）。**

- 停靠面板的 **root Panel**（不是子 canvas、也没有 Window 对象）会收到 `onResizing` /
  `onResize`，且触发时 `size` / `bounds` / 子控件 `size` 已经是新值（宿主先
  `__uiLayout` 再 `__fire`）。事件没有 payload，读 `this.size`。
- 实测：脚本设 `preferredSize = [340,530]`，打开后 root/canvas 收到 **298×827**（右栏 300 宽，
  减 2px 边框）；主窗口 `ui.resize 1400×900` 后变成 **298×718**；再缩到 1000×700 变成
  **298×518**。`scriptui.list` 的 `size` 同步变化。
- 宿主把停靠尺寸通过 `scriptui.resize {window, size:[w,h]}` 发给脚本（每次尺寸变化一次；
  首次打开也会发一次）。脚本也可以自己调 `scriptui.resize`，但停靠 root 下一帧会被宿主
  重新钉回停靠尺寸，所以不要用它改停靠面板。
- **滚动条**：`preferredSize` 仍会发给宿主，dock root 每帧 `fixed_bounds = max(preferred, dock)`。
  preferred 比停靠区大时，即使 root 已经填满停靠区，宿主仍会出现滚动条（实测 preferred
  340×530、dock 298×827 时右/下都有滚动条）。KCurve 1.1.1 在 0.19+ 把 root 和 canvas 的
  preferred 都设为布局下限 **200×300**，滚动条消失；停靠区小于 200×300 时才出现。
- `minimumSize` / `maximumSize` 不会被发送，设了也无效。
- 兼容策略：按 `app.version` 里的 `EffectCraft x.y` 判断是否 ≥ 0.19；旧版仍用 340×530 固定画布。

## 7. 其他实测坑

- **根窗口 onDraw 不绘制**；必须在子 `panel` 上画。
- `panel` 内边距默认 `[10,15,10,10]`，画布要贴边时把画布自己填满窗口（stack + fill），
  内容用内边距绘制。
- `new Window("palette", …, {resizeable:true})` 的 OS 窗口本身不可拖边缘（宿主设
  `resizable(false)`），但脚本改 `win.size` 有效。
- `app.scheduleTask`：0.13.0 的 GUI 实测**不执行重复任务**。命名函数 + 字符串调度、
  点击事件里调度、浮窗和停靠 ScriptUI 面板都试过，计数一直是 0；`script.runTasks` 报
  “scripting is not available in this build”。脚本结束时调度的 one-shot 会立即执行一次，
  但没有帧循环。因此持续旋转/折叠动画在本版本无法用脚本定时器实现。
- 鼠标事件只在画布内；拖出窗口会丢失 mousemove。0.17.0 依然**没有鼠标捕获 API**：
  `window` / `panel` / `canvas` 上没有 capture 成员，`ScriptUI.events` 只有 `createEvent`，
  MouseEvent 字段里也**没有 `buttons`**（只有 `button`，mousemove 时为 0），所以无法判断
  “拖出窗口之后按键是否还按着”。旧版 KCurve 在 `mouseout` 时结束拖拽，避免指针回来时误拖。
  **0.19.0 已修复（上游 #2584 / PR #2624）**：按下按钮后，`mousemove` / `mouseup` 会一直发给
  按下的那个控件，坐标 `clientX` / `clientY` 可以是负数或超出控件（实测拖到面板外收到
  `clientX=-817`，最后 `mouseup` 也送到画布，`buttons` 从 1 变 0）。每个 MouseEvent 都有
  `buttons`（DOM 位掩码：1 左、2 右、4 中；mousemove / out / over 的 `button` 恒为 0）。
  `mouseout` / `mouseover` 仍按 hover 触发，所以**不能**再用 mouseout 结束拖拽；KCurve 1.1.1
  改成用 `buttons` 判断（`buttons === 0` 且此前确实按下过，才视为松手事件丢失并收尾）。
  仍没有 OS 级抓取：平台停止上报指针位置时不会补事件（没有 PointerGone 分支），所以这个
  兜底要保留。
- `Property.selectedKeys` 可读不可写；用 `app.run("keys.select", …)` 选中。
- 脚本可以 `app.run` 引擎命令，但 `scriptui.*` 会报 “scripts can't drive script windows”。
- `keyTime` 是 comp 时间；层的 `stretch` 需要参与缓动时长换算。
- 自定义 `onDraw` 文本由宿主用 `Tokens::ui(size)` 画（见 `scriptui_view.rs::paint_draw`），
  `ScriptUI.newFont` 的 family/bold **不会生效**，只有字号生效。所以“换成 EffectCraft 字体”
  实际上是自动的；脚本能做的是字号层级和 `textBox` 垂直居中，而不是指定字体 family。
- `drawPath` 只有 Graphics 级 API：`g.newPath()` 清空当前路径，`g.moveTo` / `g.lineTo`
  追加，`g.fillPath(brush)` / `g.strokePath(pen)` 画当前路径；不存在 Path 对象方法。
- 自绘圆角矩形用折线近似且宿主不做 MSAA；KCurve 每角段数现在是 **3–6**
  （1.0.4 起），半径 10px 的角最大偏差约 0.2px；再细也看不出来，只会增加每帧路径点。
  圆形用 `ellipsePath`（宿主直接画椭圆）。
- 链条语义：`allowOvershoot=false` 画连接链；`true` 画断开链（越界 = 断链）。

## 8. KCurve 实测记录

- Opacity 0→100 @1s，写入 `cubic-bezier(0.2,0,0,1)` 后 `keys.info` 读到
  `outInfluence=20, outSpeed=0` / `inInfluence=100, inSpeed=0`；导入回读得到
  `cubic-bezier(0.2, 0, 0, 1)`，往返精确。
- `cubic-bezier(0.354,0.333,0,1)` 写入后 out influence 35.401，speed 117.58（%/s），
  与 `avgSpeed=124.88`、`y1/x1` 计算一致。
- Position（Spatial）3 个关键帧：`keys.info` 显示 `dims:1, spatial:"autoBezier"`，
  只写了一个 ease；应用与导入均正常。
- **多点模式**（每个点=一个关键帧，每个点带入/出操纵杆，只显示选中点的杆）：
  - 单段 → 多点用 de Casteljau 在中点切一刀，端点/中点拉杆精确来自原 cubic，形状不变；
    删回 2 点后恢复原 cubic。
  - 选中 2 个关键帧（1.8018→2.6026，0→100），切到 3 个点后点 √：
    在 50% 时间 2.2022 新增 value=50 的关键帧；状态 `替换 2 个选中键（新增 3）`。
  - 把中间点拖到 t=0.54 / v=0.75 后再点 √：旧的选中键被删除并重建，
    关键帧移动到 2.2356，值 74.64，**没有留下重复键**。
  - 多点写入的 ease 由每段的拉杆换算：`x1=(hOut.x-p.x)/(q.x-p.x)`、
    `y1=(hOut.y-p.y)/(q.y-p.y)`，入侧同理；再乘该段的 `slopes()` 得绝对速度。
  - 多点杠杆默认**独立**（`smooth=false`），所以拖一侧时另一侧不会跟着甩；按 S 才把它们
    约束成共线。v1 状态里的多点 `smooth:true` 在载入时迁移为 false（`STATE_VERSION=2`）。
  - 脚本 API 里 `property.setKeyTime` 不存在（`undefined`），但
    `property.removeKey` / `addKey` / `nearestKeyIndex` 可用；KCurve 用
    “倒序 removeKey 再 setValueAtTime”来移动关键帧。
  - 选中 3 个关键帧点导入：3 个点的时间/值归一化正确，按钮状态显示“3 个关键帧”。
- 实时写入开关关闭时拖动只改曲线（keys.info 不变）；单段模式开启后拖动立即改 ease，
  mouseup 后状态为“已实时写入缓动”；多点模式在 1.0.1 及以前只预览，点 √ 才写时间线
  （1.0.2 修复后多点模式也会实时写，见 §8.1）。
- 浮动窗口改 `win.size` 后 `layout.layout(true)` 生效；右边缘只改宽、下边缘只改高。
- 预设保存/重命名/拖动排序/分组折叠/展开/复制到用户组均持久化到
  `<config>/script_settings.json`。
- `verify/ease_math_probe.jsx` 独立数值验证：5 条曲线 opacity/position 采样最大误差
  约 1e-10～1e-12，回读误差 < 3.4e-13。详见 `verify/EASE_MATH.md`。

### 8.1 1.0.2 修复：多点实时写入与选中状态（0.17.0 实测，2026-10-28）

两个 bug 的根因与修法：

1. **多点模式实时写入无效**：`applyLive()` 对多点模式直接 `return`，且拖点的
   `liveMode` 被 `S.realtime && !isMulti()` 关掉。现在多点拖拽也走实时写入，
   写入按 ~40 ms 节流（mouseup 再强制补一次），拖动结束状态为“已实时写入多点关键帧”。
2. **多点应用后丢失选中**：`applyMultiCurve()` 用 `removeKey` + `setValueAtTime` 重建关键帧，
   时间线选中状态会被清空，而 `Property.selectedKeys` 是**只读**的
   （`TypeError: cannot set non-writable property`）。现在写入后用引擎命令恢复选中：

   ```js
   app.run("keys.select", {
     keys: [{ layer: layer.__id, prop: property.__uid, time: property.keyTime(k) }],
     timeBase: "comp"          // keyTime() 在这个宿主里是 comp 秒
   });
   ```

   - `layer.__id` / `property.__uid` 都存在；`prop` 只认 uid 或 path，
     `p.name` / `p.matchName` 会报 “no such property on layer”。
   - 没有 `__id` / `__uid` 的构建会静默跳过恢复（不影响写入）。
   - 当时间线已经存在与曲线点完全对应的关键帧（数量、时间都对得上）时，
     只更新值/缓动，不删键重建——这样实时拖拽时选中状态根本不会丢，也更快。

实测数据（停靠面板 340×530 与浮动面板 600×780 都跑过）：

- 选中 2 键（1 s→2 s，0→100）→ 点 + 切到 3 点 → 点 √：
  `numKeys=3, times=[1,1.5,2], values=[0,50,100], selectedKeys=[1,2,3],
  selectedProperties=1`；状态栏显示 “Wrote multi-point curve… / 3 keys selected”。
- 打开齿轮后把中间点从 v=0.5 拖到 v≈0.66：
  时间线中间键值立即变为 65.48～65.57，`selectedKeys` 仍是 `[1,2,3]`。
- 横向拖动改变点时间：`times=[1,1.5667,2]`，选中仍是 `[1,2,3]`（重建 + 恢复路径）。
- 关闭齿轮后再拖：时间线不变，符合“只预览”。

已知遗留（0.17.0，与本次修复无关）：脚本在**多个鼠标事件之间**保持的
`app.beginUndoGroup()` 不会真正合并——单段模式的实时写入同样会一次拖动产生多个
undo 步骤（实测 1 次拖动 = 6 个 “Keyframe Velocity / Interpolation” 步骤）。
若要一次拖动一步撤销，需要把实时写入改成 mouseup 时一次性写入，或者等宿主提供
可跨事件合并的 undo 组。

验证脚本：

- `verify/multipoint_probe.jsx` — 引擎层：重建后选中恢复、只改值不丢选中、
  点时间变化后恢复、`selectedKeys` 只读、prop 引用形式。headless 即可跑。
- `verify/e2e_setup.jsx` + `verify/e2e_read.jsx` — 真实 UI 端到端：配合
  `effectcraft --control <port>`、`scriptui.mouse` 点击/拖拽，读回关键帧状态。

### 8.2 1.0.3 绘制精简（0.17.0 实测，2026-10-28）

按“性能优先”去掉编辑器的三块每帧开销：

- **顶部信息行**（单段 `cubic-bezier(...)`、多点“N 个关键帧 · 选中 · t / v”）：
  每次重绘都要拼字符串 + 走 `textBox`/measureString；
- **网格**：5 横 + 5 竖共 10 条 `stroke`（`line()` 每条 1 个 path、2 个点）；
- **圆角**：编辑器卡 radius 24、画框 radius 18、0–1 边界框 radius 10 都是
  `fillRound`/`strokeRound` 的多段折线（每角 7–14 段），而宿主不做 MSAA，
  圆角本来也只是折线近似。现在三处都改成 `fillRect`/`strokeRect` 的方角矩形。

省出的顶部 18px 直接并入曲线区（plot 从 `r.y+28` 移到 `r.y+10`，高度 +18）。

实测（浮动面板 600×780、默认单段曲线，取 `scriptui.get` 的 onDraw 绘制列表，
编辑器区域 = y ≤ 292 的指令）：

| 指标 | 1.0.1 | 1.0.3 | 变化 |
|---|---|---|---|
| 编辑器区域绘制指令 | 27 | 17 | −37% |
| 编辑器区域路径段 | 269 | 131 | −51% |
| 整个面板路径段 | 1385 | 1247 | −10% |

剩余大头：曲线描边本身 `strokeCurveSegments` 每段采样 56 点、glow + 主线各描一次
（3 点曲线 ≈ 2 段 × 2 × 56 = 224 段）。要再压缩可把采样降到 32 左右（视觉几乎无差），
目前保留 56 以保证过冲/回弹等大曲率段的平滑。

功能回归：停靠面板 340×530 上“选中 2 键 → + → √”仍写入 3 键并保持选中；
齿轮打开后拖动中间点，时间线值 50 → 64.04，选中仍为 `[1,2,3]`（plot 位置变了，
E2E 坐标按新几何 `plot=(18,18,304,171)` 复核）。

### 8.3 1.0.4 第二轮绘制精简（0.17.0 实测，2026-10-28）

在 1.0.3 的基础上继续压缩每帧绘制列表：

- 去掉编辑器左下/右上的 `0` / `1` 角标，删除只给它们用的 `text()`（`textWidth` 保留，
  `measureControl` 和状态栏还在用）；
- `strokeCurveSegments` 采样 56 → 32；`miniCurve` 24 → 12（缩略图 ~30px，肉眼看不出）；
- `roundPath` 每角段数 `4..14` → `3..6`：半径 10px 的角用 4 段，最大偏差约 0.19px，
  方框/胶囊/缩略图外观基本不变；
- `drawTool` 只给齿轮图标取当前时间，其它图标不再每帧建 Date；
- `KCurveSpinTick`：实时写入关闭时不再无条件整块重绘，只有选中关键帧数变化才刷新
  （齿轮的旋转小点只在实时写入开启时才需要动）。实测 `app.scheduleTask` 在 0.17.0 的
  实时写入状态下确实在跑（80ms 两次抓取的绘制列表不同），所以这条能省掉空闲时的重绘。
- 顺手修正实时写入按钮的悬停提示（1.0.2 起多点也实时写，不再说“只预览”）。

实测（停靠面板 340×530、默认单段曲线、首帧绘制列表，1.0.1 → 1.0.4）：

| 区域 | 1.0.1 段数 | 1.0.4 段数 | 变化 |
|---|---|---|---|
| 编辑器 | 269 | 83 | −69% |
| 工具栏 | 493 | 361 | −27% |
| 预设区 | 617 | 381 | −38% |
| 合计 | 1379 | 825 | −40% |
| 绘制指令 | 103 | 90 | −13% |

浮动面板 600×780 同样测过：1385 → 831 段（−40%）。再往下压就要牺牲视觉了——
剩下的主要成分是界面里必须画的东西：约 20 个圆角控件背景（每个 ~21–25 段）、
7 条预设缩略曲线（各 13 段）、主曲线 glow+主线（各 33 段）和状态/名称文字。

功能回归：340×530 面板上“2 键 → + → √”仍写入 3 键并保持选中；齿轮开启后拖中间点，
时间线值 50 → 64.04，选中仍 `[1,2,3]`。

### 8.4 1.0.5：两行工具栏、悬停底色、预设可编辑（0.17.0 实测，2026-10-29）

- 工具栏固定两行：上排 = 导入 / 超出边界 / `+` / `−` /（平滑）/ `√`；下排 = 语言 /
  实时写入 /（入 / 出 / 双侧）。不再按宽度自动换行，窄面板也不会挤成一团。
- 控件默认不画底色，只画图标/文字；悬停、按下、选中的模式才画 chip。预设缩略图在未选中
  且未悬停时也不画方块底。静止画面（340×530）绘制指令 90 → 69，路径段 825 → 347
  （−58%）；悬停时只多画一个 chip（约 22 段）。
- 内置预设改为可编辑：`STATE_VERSION = 3`，首次加载把 Material 3 / Classic 克隆进
  `S.userGroups`（保留 id 和曲线），之后 `allGroups()` 只读用户组；右键菜单统一为
  加载 / 加载并应用 / **用当前曲线更新该预设** / 重命名 / 复制 / 删除。
  `groupDisplayName` 只在名字仍是默认值时才翻译，用户改过名就原样显示。
- 旧状态（v2）自动迁移一次；v3 之后不再添加，删掉内置组也不会复活。
- 验证：340×530 面板上“2 键 → + → √”写入 3 键并保持选中；齿轮开启后拖中间点
  50 → 64.04；右键 Material 3 预设的菜单包含
  “Update this preset with the current curve”。

### 8.5 1.0.6 / 1.0.7：应用按钮占满上排剩余宽度（2026-10-29）

- `layoutFunction` 先放上排工具，再把 `button:apply` 的 `x` 设为游标、宽度设为
  `(x + w) - apply.x`；勾图标用 `iconX = apply.x + apply.w / 2` 居中（1.0.7），
  勾的大小改成只跟高度（`min(1, h/32)`），不再按宽度缩放，宽按钮里不会变成小点。
- 整条按钮都是命中区：悬停/按下画整条 chip，静止时只有中间一个蓝勾。
- 整条按钮都是命中区：悬停/按下画整条 chip，静止时只有右端一个蓝勾。
- 验证：340×530 面板上多点模式的 apply 从 `163` 到 `332`（宽 169），点击 `(300,221)`
  能写入 3 个关键帧。

### 8.6 1.0.8：细边框、透出宿主底色、弹跳预设组（0.17.0 实测，2026-10-29）

- **编辑器细边框**：`drawEditor` 只填充一次 `P.bg`，再用 `strokeRect` 画 1px
  （`P.outline` 0.7 alpha）；不再有 `P.surface` 卡片和 10px 内边距，plot = 编辑器区域 -1px。
- **面板不再画背景**：删掉 `drawBackground` 的整块 `P.bg` 填充，也删掉预设区上下两条遮罩填充；
  未绘制处直接显示宿主面板底色。实测宿主面板色 `(35,35,35)`，与 EffectCraft 的「效果和控件」
  面板完全一致（含主题/亮度）。静止画面再少 3 条绘制指令。
- **预设格子**改为只画完整可见的行：`cell.rect.y >= list.y && cell.rect.y + h <= listBottom`；
  没有遮罩后，半截格子会溢出到状态栏/面板外，所以直接跳过。
- **新增「弹跳」组**（`builtin_bounce`）：`multiPreset(pts)` 用 Catmull-Rom 切线生成手柄，
  6 条 4–6 点曲线（落地回弹 / 回弹两下 / 弹簧 / 果冻 / 弹入 / 小回弹），y 值含过冲
  （1.04 / 1.15 / -0.12 等）。
- **修复多点过冲预设被压平**：`loadPreset` 原来先 `ensureMultiHandles`（内部
  `clampAnchorHandles` 会把 y 钳到 0–1），再做“是否越界”判断，过冲值已经被吃掉。
  现在先判断越界、再补手柄；载入“落地回弹”后 0–1 边界框出现、6 个锚点保留过冲位置。
- **状态版本 4**：v3 设置走 `migrateBuiltinGroup(st, "builtin_bounce")`，只补新组并插到
  Classic 之后，已有的组/删除操作不受影响；`visibleGroups()` 上限 3 → 5，四个内置组都可见。
- 实测迁移：v3（m3/classic/g_user）→ v4 后 groups = [m3, classic, g_user, bounce]，
  order = [m3, classic, bounce, g_user]，bounce 组 6 条。

### 8.7 1.0.9：删掉演示弹跳、悬停底色统一、应用按钮描边（0.17.0 实测，2026-10-29）

- **弹跳组内容改为用户自己的预设**：1.0.8 内置的 6 条演示曲线删掉，`BUILTIN_GROUPS` 里的
  `builtin_bounce` 只留空模板（`presets: []`，迁移时跳过空模板）。
  `STATE_VERSION = 5` 的 `migrateBounceFromUserGroups()` 把当时「我的预设」里的内容深拷贝进
  弹跳组（新 id、保留名字/锚点）；之后两组互不影响。新装没有这个组。
- **工具栏悬停底色**：`P.high` → `P.highest`，与组 chip / 预设格子一致。
- **应用按钮**：描边常驻（`strokeRound` 无条件画），悬停叠加 `withAlpha(P.primary, 0.2)`，
  按下才整条 `P.primary` 填充。
- 实测：把真实 v4 设置（我的预设 3 条 4 点曲线 + 弹跳 6 条演示）放进测试配置，
  打开面板后版本变 5，弹跳组变成「缓入弹跳 / 突入弹跳 / 后跳」三条 4 点曲线的副本，
  「我的预设」保持 3 条不变。

### 8.8 1.0.10：写入边按钮常驻（2026-10-29）

- 1.0.5 起，多点模式会把「入 / 出 / 双侧」三个按钮从下排移除（`if (!isMulti())`）——用户看到的是
  “选择关键帧类型不见了”。现在三个按钮**始终存在**，多点模式下 `disabled: true`：
  图标用 `withAlpha(P.faint, 0.55)`、不画悬停/选中底色，点击时状态栏提示
  “多点模式按点写入两侧，入 / 出 / 双侧只在单段模式生效”。
- `activate()` 里三个 mode 分支合并处理：多点模式直接返回，单段模式照常切换 `S.applyMode`。
- `iconHint()` 在多点模式悬停这三个按钮时也给出同样的说明。

### 8.9 1.0.11：重绘触发从 notify 换成 layout（0.18.0 实测，2026-10-29）

- 问题：`notify("onDraw")` 在 0.17/0.18 里会跑**两遍** onDraw —— notify 自己调一次，宿主重绘整窗
  再调一次。用两画布 probe 实测：没有任何 notify 的普通点击 → 两个画布各 +1（整窗重绘会重跑
  所有 onDraw）；对 A notify → A +2、B +1。
- 方案：`redraw()` 改用 `(win || canvas.window).layout.layout(true)` 触发重绘，layout 只触发一次
  整窗重绘。实测 40 次悬停的 onDraw 从 **80 次降到 40 次**；onDraw 平均约 4ms，等于每帧脚本耗时
  8ms → 4ms。画面（悬停底、状态栏、曲线拖动）验证正常；没有 `layout` 对象的宿主回退到 notify。
- 顺带确认：`ScriptUI.newImage(120,80)` 报 TypeError，脚本不能创建图像缓存；没有脏矩形/局部
  重绘 API，拆多个自定义画布也不会减少总工作量（每帧所有 onDraw 都会跑一遍）。

### 8.10 1.0.12：实时写入由编辑器接管、节流调整、保存默认组（0.18.0 实测，2026-10-29）

- **多点删点残留**：实时写入时 4 点删成 3 点时，时间线上被删掉的键会留下（`applyMultiCurve`
  只删“选中键”，范围内未选中的键不动）。1.0.12 起实时写入把首尾范围视为编辑器所有：
  范围内不属于曲线点的键（不论是否选中）全部删除；4→3 删点后立即 `applyMultiCurve(true)`。
- **3 点→2 点回到单段**：原来只切模式，单段实时写入只写缓动、不删键，中间键留在时间线。
  现在 `deleteAnchor` 在实时写入开启时调用 `pruneRangeMiddleKeys()`（删范围内除首尾外的键并重新
  选中首尾），再 `applyCurrent(true)` 写入恢复后的缓动。实时写入关闭时行为不变（只改预览）。
- **节流**：多点实时写入 40ms → 80ms（时间线少重建一半）；重绘 24ms → 16ms（约 60fps）；
  拖动期间曲线采样 32 → 20（`drag.kind` 为 handle/anchor 时），松手后最终帧用 32。
- **保存预设默认组**：`saveCurrentAsPreset()` 原来固定传 `groups[0]`，现在按 `S.selectedGroupId`
  找到当前组传给 `presetSaveDialog()`，右键保存时下拉框默认就是当前组。

### 8.11 1.0.13：设置菜单（语言 + 实时写入模式）（0.18.0 实测，2026-10-30）

- 下排第一个按钮由地球（`icon:lang`）换成三横线（`icon:settings`，新增 `hamburger` 图标）。
  `activate` 打开 `openSettingsMenu()`，复用已有的 `menu` 覆盖层：
  - 语言：English / 中文（带 ✓ 的当前项，`setLanguage()` 不变）；
  - 实时写入模式：「停止拖动后写入」开关（✓ = 开）。
- 新增状态 `S.writeOnRelease`（默认 false，存进 `app.settings` 的 `writeOnRelease`）。
  打开时 `applyLive()` 直接返回；`canvasMouseUp` 的 handle/anchor 分支在 `endLiveGroup()` 后
  写一次（多点 `applyMultiCurve()`、单段 `applyCurrent(false)`），状态栏提示“已写入…（停止拖动后写入）”。
- 多点范围清理（1.0.12 的 `if (live)`）改成 `if (S.realtime)`，所以停止后写入模式同样由编辑器
  决定首尾之间的键。

### 8.12 1.1.0：英文翻译完善（2026-10-30）

- 补全 `EN` 映射缺失的三个键：`设置` → "Settings"、`实时写入模式` → "Live write mode"、
  `停止拖动后写入` → "Write on release"（1.0.13 的英文界面下这三条会显示中文）。
- 润色：多点模式提示补 "only"、单段模式统一写 "single-segment mode"、平滑/折断提示改成
  "Click to make the levers independent" / "Click to align the levers"、实时写入状态去掉
  "immediately"、缓动应用结果从 "ease side" 改成 "easing side"、添加点提示改成 "with levers"。
- 删除已不再使用且内容过时的 "Live write (multi-point previews only)" 条目。
- 版本 1.1.0 作为 1.0.10 之后的大版本发布，汇总 1.0.11–1.0.13。

### 8.13 1.1.1：自适应停靠 + 拖动捕获（0.19.0 实测，2026-10-31）

- **布局改成完全由实际画布尺寸驱动**：`buildLayout(g, W, H)` 里 `W/H` 来自 `onDraw` 的
  `this.size`；编辑区 `clamp(H*0.38, 110, 340)`，剩余高度给预设库；预设列数按宽度重算。
  面板最小布局 200×300（`MIN_DOCK_W/H`），比这更小才由宿主滚动。
- **停靠尺寸**：root 面板挂 `onResizing`（`redraw()` 节流）/ `onResize`（`redraw(true)`）；
  0.19+ 把 root 和 canvas 的 `preferredSize` 设为 200×300，消掉宿主滚动条（0.13–0.18 仍是
  340×530）。判断版本用 `app.version` 的 `EffectCraft (\d+)\.(\d+)`，≥ 0.19 才启用。
- **鼠标捕获**：`noteButtons(e)` 首次看到数值 `e.buttons` 就认定新宿主；`mouseout` 只清 hover /
  pressed，不再取消 drag；`mousemove` 里 `buttons === 0 && pressedHeld` 视为松手事件丢失并
  `finishDrag(e)`；旧宿主（没有 `buttons`）保持原 mouseout 取消逻辑。
- **预设组排序**：0.19 会在面板外很远的地方送达 `mouseup`；松手点不在预设区（含 8px 余量）时
  取消排序，避免把组丢到末尾。
- 实测：`ui.drag` 从 hOut 操纵杆拖到面板外 (700,900)，收到连续负 `clientX`，松手后
  `app.settings` 里 anchors 的 hOut 变成 `{x:0.03,y:0.03}`（clamp 后的值）并保存；
  之后点齿轮实时写入仍能正常切换。三种停靠宽度 298 / 558 / 210 下截图检查通过，预设列数
  4 / 7 / 2，宽度 ≥ 200 时无宿主滚动条。

### 8.14 1.1.2：跟随 0.19.0 的脚本颜色空间（2026-10-31）

- 0.19.0 的 #2272 把 ScriptUI 颜色从「线性光 + sRGB 输出」改成「普通 sRGB 直出」。KCurve 的
  `C(hex)` 以前一直做 sRGB→线性来抵消旧 bug，所以在 0.19.0 上所有面板色变暗：`#A8C7FA`
  画成 (100,146,244)、`#737379` 画成约 (43,43,49)，状态栏和禁用按钮几乎看不见。
- 1.1.2 在 `C()` 里按 `hostVersionAtLeast(0,19)` 选颜色空间：0.19+ 用 `v/255`，更早用
  `srgbToLinear(v)`。实测 0.19.0 上 `#060607` → (6,6,7)、`#1F3550` → (31,53,80)、
  `#A8C7FA` → (168,199,250)、`#737379` → (115,115,121)，与目标 hex 完全一致。
- 用一个直接画裸 sRGB 值的探针面板确认了 0.19.0 的新语义：`#2B2B2B` → (43,43,43)、
  `#D8D8D8` → (216,216,216)、`#F28C28` → (242,140,40)，逐字节相等。
- 这条判断和 §6 的停靠版本判断共用 `hostVersionAtLeast()`；AE 移植版没有 EffectCraft 的
  `app.version`，仍保持 1.1.0 的界面色板逻辑。

### 8.15 1.1.3：折叠工具栏、星星保存、预设组 +（2026-10-31）

- **工具栏**：常驻行 = ☰（折叠）+ √ 应用 + ☆ 保存预设。工具默认折叠（`S.toolsOpen = false`，
  存 `app.settings` 的 `toolsOpen`）；展开后第一行最多 5 个工具，按宽度自动换行到下面的行。
  应用宽度 = 星星左侧剩余空间（最小 36px），所以星星不会把勾挤掉。
- **设置菜单**：左键 ☰ 直接展开/收起，**右键** ☰ 打开设置菜单（语言、显示工具栏、
  停止拖动后写入）。状态栏悬停提示当前展开/收起状态。
- **预设标题栏**：只保留「预设库」文字；「新建预设组」的 + 右对齐到组 chip 行最右边
  （`layoutPresets` 里 `ngX = rect.x + rect.w - 26`，和最后一个 chip 相撞时换行），
  「保存」改成工具栏的 ☆。空组提示改成「点右上角 ☆ 保存」。
- **导入图标**：按参考图改成前面圆角方块 + 后面 L 形纸张（`drawIcon` 的 `import` 分支）。
- 实测：298/512/210 宽度下展开/折叠布局、☰ 左键切换 + 右键菜单、☆ 保存对话框、
  组行 + 新建组对话框均通过；`toolsOpen` 重启后保持。

### 8.16 1.1.4：组位 +、文档导入图标、固定首尾点、平滑图标、逐工具开关（2026-10-31）

- **新建预设组 +**：1.1.3 把它右对齐在 chip 行末尾；1.1.4 按反馈改成“组位”——紧跟在最后
  一个组 chip 后面、跟着 chip 换行（`layoutPresets` 里 `chipX` 游标继续往后排）。
- **导入图标**：改成两张叠放文档——后一张从左下露出，前一张带右上折角和两条文字线
  （`drawIcon` 的 `import` 分支用折线画，不用 fill）。
- **首尾点固定**：`clampAnchorHandles()` 强制第 0 点 (0,0)、最后一点 (1,1)；`canvasMouseDown`
  对这两个锚点只选中、不建 drag，状态栏提示可以拖操纵杆；`loadState` / `loadPreset` 调
  `enforceEndpoints()`。`drawEditor` 的 plot 由 1px 内缩改成 **12px**（选中圆环外半径），
  首尾点圆环不再越出编辑器边框。
- **平滑 / 折断图标**：折断（不联动）用原来的折线图标；平滑（联动）改成一条贝塞尔曲线
  （12 段折线采样）。`state.filled` 仍表示当前点是否平滑。
- **逐工具显示开关**：`TOOL_VISIBILITY` 列出 9 个工具；`toolVisible(id)` 过滤
  `toolControls()`；`S.toolVisible`（只存 false）在设置 ▸ 工具显示…里逐项切换并持久化。
  整栏折叠（`toolsOpen`）保留，两者独立。
- 实测：取消「导入」后工具栏重排且刷新后仍隐藏；首尾点拖拽被拒；平滑点显示贝塞尔图标；
  预设组 + 紧跟最后一组；截图见 `.tmp/shots/d5-*`。

### 8.17 1.1.5：平滑 / 折断按钮常驻（2026-10-31）

- 1.1.4 的 `toolControls()` 里 `icon:smooth` 只在 `isMulti()` 时加入；删掉中间点回到单段后按钮
  消失，用户反馈“平滑和折断不见了”。
- 1.1.5 改成常驻：单段模式 `disabled: true`（`drawTool` 用 faint 颜色），`iconHint` 提示
  “多点模式才需要平滑/折断”；点击走 `toggleSmooth()` 原有的单段保护，状态栏说明原因。
  多点模式恢复 `active` 并按选中点显示贝塞尔 / 折线图标。

### 8.18 1.1.6：导入图标去掉背面右下角的上翘（2026-10-31）

- 背面纸张的路径原来在底边右端又向上折一小段（`lineTo(cx + 5, cy + 5)`），在 28px 图标里
  会从下面那行文字中间穿出来。1.1.6 让背面只画到右下底边为止，同时把前面文档的两条文字线
  上移 1px，底边留白更干净。

### 8.19 1.1.7：预设拖动、顺序缓存、保存对话框（2026-10-31）

- **拖动预设**：mousedown 在格子上建 `drag.kind="preset"`，移动 >4px 激活；`computePresetDrop`
  先看指针是否在某个组 chip 上（跨组移动），否则按 `list`、`S.scroll`、`cols/cellW/cellH`
  算行/列，右半格插入到后面。`applyPresetDrop` 跨组时从原组移除、追加到目标组末尾、
  `selectedGroupId` 切到目标组；组内则 splice 重排。
- **顺序不刷新**：`presetLayoutKey` 原来只包含组名和预设数量，不含预设 id 顺序，重排后
  `presetLayoutCache` 仍返回旧 cells；现在把每个预设 id 按顺序拼进 key，并在 drop 后清缓存。
- **保存对话框**：去掉「新建组名」输入框（之前焦点常落在它上面，用户输入预设名时会不小心
  建成新组），只剩名称 + 保存到组；`name.active = true` 把焦点放到名称框。`saveCurrentAsPreset`
  在组名缺失时回退到当前组/第一个组，不再凭空建组，并在保存后选中新预设、切到目标组。
- 实测：组内拖动后状态与截图顺序一致；拖到「经典」chip 后预设进入 Classic 并自动切组；
  Save Preset 对话框高度 180，两行字段。

### 8.20 1.1.8：点击反馈、预设库左右侧、蓝框、齿轮、去标题（2026-10-31）

- **点击反馈**：`drawTool` 的 `solidPress` 让 `icon:import` / `icon:add` / `icon:del` /
  `button:savePreset` 按下时整格 `P.primary`、图标 `P.bg`，悬停 `withAlpha(P.primary, 0.2)`。
- **预设库位置**：新增 `S.presetSide`（top/left/right，默认 top）。`buildLayout` 的 side
  分支把工具栏+编辑器放一侧、预设区放另一侧；`editorW < 190` 时退回 top。设置菜单
  「预设库位置」写入 `presetSide`。600×829 实测左侧布局正常。
- **编辑器蓝色描边**：`drawEditor` 的 `strokeRect` 改成 `withAlpha(P.primary, 0.8)`、1.5px。
- **齿轮**：`drawIcon("gear")` 用 12 齿外轮廓 + 反向内圆 path；关=白描边，开=蓝填充且中心
  留孔（非零填充规则）。`drawTool` 把时间换算成 `state.angle`，整条 path 旋转。
- **停靠面板旋转修复**：`startSpinTask()` 原来只在浮动窗口调用，且 `kcurveSpinTick` 要求
  `win` 非空；停靠面板 `win=null` 导致任务第一帧就停。现在面板也 `startSpinTask()`，tick
  只要求 `canvas`，并把 `KCurveSpinTick` 挂到 `$.global` 供 `scheduleTask` 解析。
- **预设区标题**：`layoutPresets` 的 `headerH` 改为 0，去掉「预设库」text；chip 从顶部开始。
- 实测：导入/添加按下变蓝；齿轮两帧差异存在；齿轮中心孔取色 = 宿主背景；
  600×829 左侧布局截图通过。

### 8.21 1.1.9：实时写入关闭时齿轮静止（2026-10-31）

- 1.1.8 的齿轮角度一直取墙上时间，虽然 spin task 只在实时写入开启时主动重绘，但悬停、
  选择变化等其它重绘也会让齿轮换一个角度，看起来仍在转。1.1.9 让 `drawTool` 只在
  `S.realtime` 为真时传时间角度，否则传 0，关闭状态下齿轮固定不动。

### 8.22 1.1.10：编辑器圆角（2026-10-31）

- `drawEditor` 的卡片背景和蓝色描边改用 `fillRound` / `strokeRound`，半径 8px；plot 仍内缩 12px，
  曲线/首尾点/边界框位置不变。

### 8.23 1.1.11：删除点与键盘限制（2026-10-31）

- 探针面板（`KeyProbe.jsx`）在 0.19.0 上监听 `keydown` / `keypress` / `keyup` 并读
  `ScriptUI.environment.keyboardState`：点击面板、`ui.focus` 后发送 Delete / A / Cmd+Z，
  日志只有 mousedown/click；`keyboardState` 始终是
  `{shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,keyName:""}`。ScriptUI 源码
  （`scriptui.js`）也只派发鼠标事件，没有键盘路径。**所以 Delete 键在当前版本无法实现。**
- 1.1.11 的可用删除方式：中间点 **Alt+单击**（`canvasMouseDown` 在 hitTest 后判断
  `hit.kind === "anchor" && e.altKey` → `deleteAnchor()`）；右键锚点弹出
  「删除这个点 / 平滑 / 折断」菜单。`canvasKeyDown` 仍注册 Delete/Backspace，宿主未来支持
  键盘事件时会自动可用。
- 首尾点继续受 `deleteAnchor()` 保护；单段模式没有可删的中间点。

### 8.24 1.1.12：操纵杆默认全部可见（2026-10-31）

- `drawEditor` 原来在多点模式下 `if (multi && ai !== selected) continue`，只画选中点的杆。
  1.1.12 改成 `if (multi && S.onlySelectedHandles && ai !== selected) continue`；新增
  `S.onlySelectedHandles`（默认 false，存 `app.settings` 的 `onlySelectedHandles`）。
  设置 ▸ 编辑器 ▸「只显示选中点的操纵杆」切换，默认关闭 = 所有点的杆都显示。
- 所有被画出的杆都会 push 到 `handlesHit`，所以默认模式下任意点的杆都可以直接拖，拖时会自动选中该点。
- 实测 4 点多点曲线：默认截图可见多个杆点；打开只显示选中点后其余杆消失，状态栏提示
  “Levers: selected point only”。

### 8.25 1.1.13：操纵杆按段限制（2026-10-31）

- `clampAnchorHandles(i)` 现在为 hIn / hOut 分别算 x 范围：
  `hIn ∈ [anchors[i-1].x, a.x]`，`hOut ∈ [a.x, anchors[i+1].x]`；首点 hOut 上界 1、末点 hIn
  下界 0。y 范围仍按 overshoot 开关（0–1 或 -1.2..2.2）。这等价于 AE 的 influence 0–100%。
- `loadState` / `loadPreset` / 两种 import 后的 `clampAllAnchors()` 不再用 `if (!allowOvershoot)`
  包着，旧曲线里跨段的杆载入时就会被收紧。
- 实测：overshoot 开、4 点多点曲线，选中点 hOut 从 0.165 拖到最右 → 最终 x=0.5（下一锚点 x），
  没有越过段边界。

### 8.26 1.1.14：经典组 9 条新曲线 + 反转（2026-10-31）

- `classicPresets()` 生成 9 条曲线，id `cl-1`…`cl-9`，名字“曲线 1”…“曲线 9”；数值按用户给的
  四组数字原样写入（`presetAnchors(x1,y1,x2,y2)`）。`BUILTIN_GROUPS` 的 classic 改用这个函数。
- `STATE_VERSION` 5 → 6；`migrateClassicPresets(st)` 找到 `builtin_classic`（或名为 经典/Classic
  的组）后 `presets = classicPresets()`。实测用 v5 状态（Classic 里有一条 OLD）打开后，
  OLD 消失、9 条曲线出现，保存后 version=6。
- **反转**：`reverseCurve()` 倒序锚点并镜像 `x,y`，交换 hIn/hOut 的角色；`icon:reverse`
  画两支 L 形箭头（90° 折角带小圆角），加进工具显示列表。单段实测 0.2,0 / 0,1 反转成
  1,0 / 0.8,1。

### 8.27 1.1.15：操纵杆可以精确落在点上（2026-10-31）

- `clampHandle` 的防重叠 nudge（距离 < 0.0004 时加 0.03 偏移）删除：用户把单段出杆拖到
  左下角时，hOut 现在精确是 `{x:0,y:0}`，不会再“挤出一点”。
- `hitTest` 的重叠优先级改为杆优先：`bestHandle && (!bestAnchor || bestHD <= bestAD)` →
  handle。杆的圆点在锚点之后绘制，所以视觉上也在上面。
- 实测：默认单段 `hOut 0.33,0` 拖到角上读回 `0,0`；在同一坐标再按下拖动，`hOut` 变成
  `0.1938,0.069`，端点仍 `0,0`，说明抓到的是杆而不是锚点。

### 8.28 1.1.16：多点导入读取真实杆（2026-10-31）

- 旧 `importMultiPoints` 把每个点建成 `hIn:null,hOut:null` 再 `ensureMultiHandles`，所以多点导入
  的杆永远是默认 1/3。1.1.16 对每段调用 `readPairCurve(p, keys[j])`，把段内归一化的
  x1,y1（出侧）和 x2,y2（入侧）映射到 `pts[j].hOut` / `pts[j+1].hIn`。
- 实测：4 个 opacity 键（influences 10/80、20/40、50/25、70/10，speed 0）导入后：
  hOut1.x=0.2667；hIn2.x=0.2667 / hOut2.x=0.4667；hIn3.x=0.5 / hOut3.x=0.75；
  hIn4.x=0.7667。全部与 influence 对应，不再是 1/3。
- HOLD / 读取失败的段交给 `ensureMultiHandles` 回退；杆 y 越界会打开 Overshoot。

### 8.29 1.1.17：浅段杆读回被压平（2026-10-31）

- 用户用「后跳」预设（4 段，第二段 y 1 → 0.9894）写进关键帧后再导入，杆的 y 全变成
  0.96825。复现后确认：预设里 hOut1 相对该段 y 差是 40（绝对 y 0.5767），而
  `readPairCurve` 最后 `clamp(y1,-2,3)` 把 40 截成 3，导入映射成绝对 y 0.96825。
- 修复：`readPairCurve` 返回原始相对 y（已有 finite 检查），绝对位置交给
  `clampAnchorHandles`（0–1 / -1.2..2.2）。实测应用→导入后杆 y 恢复为
  0.57672 / 0.59788 / 0.85185，x 只因关键帧吸附到帧而偏移 ~0.002–0.003。
- 单段导入同样受益：相对 y 不再被 [-2,3] 截断，越界由绝对范围限制。

### 8.30 1.1.18：平滑点另一根杆长度漂移（2026-10-31）

- 用户录屏里拖平滑点的一根杆时，另一根杆越拖越长。原因：每次 mousemove 都从 `other` 的
  当前位置重新计算 `lenOther`，而 `clampAnchorHandles` 可能已改变它的位置；反复“镜像 + 钳制”
  让长度累积增长。
- 修复：`canvasMouseDown` 的 handle 分支记住 `drag.otherLen0 = dist(other, anchor)`；
  mousemove 的平滑镜像只用这个固定长度。零长度时不动另一边，避免两根杆一起塌到点上。
- 实测：hIn 初始长度 0.1720465；拖 hOut 到 `(0.85,0.5)` 后 hIn 仍 0.1720465；把 hOut 拖到
  `(0.5,0.7)` 时 hIn 保持 `(0.36,0.6)`；在点上再按下拖动，抓到的是 hOut，可以拉出来。
- 段的水平边界（1.1.13）不变。

### 8.31 2.0.0：反转反馈、性能与全脚本审计（2026-10-31）

- 反转按钮加入 `solidPress`，与应用/导入/加点/减点/☆ 同一套按下反馈。
- 性能：`measure` 增加文本宽度缓存（按内容/字号/样式/上限，>2000 清空）；`selectionCount`
  120ms 缓存；无齿轮可见时自旋轮询 4 Hz；去掉操纵杆圆点重复绘制；齿轮不可见时不做 80ms
  全量重绘。
- 审计修复：`importMultiPoints` 先 `S.allowOvershoot=true` 再 `ensureMultiHandles`；
  `loadPreset` 记录 `wasMulti`，从多段切单段预设时不再因实时写入静默 apply。
- 验证：`ease_math_probe`（pass=true）、`multipoint_probe`（pass=true/failed=0）；反转按下截图
  整格蓝色；4 段过冲导入后 hOut.y=1.5/2.2，allowOvershoot=true；齿轮旋转两帧有差异。

## 9. 参考资料

- 官方 Ease Presets 源码：`examples/Ease Presets.jsx`
- 官方 agents 指南的 “Scripts and ScriptUI windows” 节：`agents.md`
- plugins.md 的 “ScriptUI panels” / “Ease Presets” 节
- ScriptUI 实现：`source/scriptui.js`、`source/engine_scriptui.rs`、`source/scriptui_view.rs`
