# KCurve 可行性验证与 EffectCraft 脚本 API 速查

验证环境：EffectCraft 0.13.0（`app.version` = `26.0 (EffectCraft 0.13.0)`），Windows，
脚本通过 live app（`effectcraft --control 9877` + MCP bridge）和 headless CLI 实测。

**结论：可行。** 做 AE Flow 类缓动面板需要的核心能力都在：

- ScriptUI 自定义绘制 + 鼠标拖拽 + `onDraw` 重绘；
- 读取当前选中关键帧（`comp.selectedProperties` / `Property.selectedKeys`）；
- 读写关键帧缓动（`keyInTemporalEase` / `keyOutTemporalEase` / `setTemporalEaseAtKey`）；
- `app.settings` 持久化预设 JSON；
- 可缩放的自定义面板（需要浮动画布，见“限制”）。

唯一明确的平台限制：**停靠的 ScriptUI 面板（`this instanceof Panel`）不会把宿主实际分配到的
尺寸同步给脚本的 `onDraw`**。详见文末。

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
- 颜色是 **linear RGBA**（0–1），宿主转成 sRGB 显示。若要精确得到某个 sRGB 十六进制色，
  先做 sRGB → linear 转换再传给 `newBrush/newPen`。
- 填充 `g.fillPath(path, brush)`，描边 `g.strokePath(path, pen)`（两个参数均可）。
- 文本坐标是左上角对齐（宿主 `Align2::LEFT_TOP`）。

### 2.3 鼠标 / 尺寸

- 鼠标事件只有画布范围内；拖动到窗口外会丢 move 事件，所以拖拽逻辑要健壮。
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
- 鼠标事件只在画布内；拖出窗口会丢失 mousemove。
- `Property.selectedKeys` 可读不可写；用 `app.run("keys.select", …)` 选中。
- 脚本可以 `app.run` 引擎命令，但 `scriptui.*` 会报 “scripts can't drive script windows”。
- `keyTime` 是 comp 时间；层的 `stretch` 需要参与缓动时长换算。
- 自定义 `onDraw` 文本由宿主用 `Tokens::ui(size)` 画（见 `scriptui_view.rs::paint_draw`），
  `ScriptUI.newFont` 的 family/bold **不会生效**，只有字号生效。所以“换成 EffectCraft 字体”
  实际上是自动的；脚本能做的是字号层级和 `textBox` 垂直居中，而不是指定字体 family。
- `drawPath` 只有 Graphics 级 API：`g.newPath()` 清空当前路径，`g.moveTo` / `g.lineTo`
  追加，`g.fillPath(brush)` / `g.strokePath(pen)` 画当前路径；不存在 Path 对象方法。
- 自绘圆角矩形用折线近似且宿主不做 MSAA；KCurve 每角段数现在是
  `clamp(round(radius*3.5), 14, 96)`，确认圆再用 192 段，并在下面垫 8 层低 alpha
  同心圆做手工软边。这样只能减轻锯齿，不能像浏览器/SVG 那样真正抗锯齿。
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
  mouseup 后状态为“已实时写入缓动”，一次拖动一个 undo 步骤；多点模式仍只预览，
  点 √ 才写时间线。
- 浮动窗口改 `win.size` 后 `layout.layout(true)` 生效；右边缘只改宽、下边缘只改高。
- 预设保存/重命名/拖动排序/分组折叠/展开/复制到用户组均持久化到
  `<config>/script_settings.json`。
- `verify/ease_math_probe.jsx` 独立数值验证：5 条曲线 opacity/position 采样最大误差
  约 1e-10～1e-12，回读误差 < 3.4e-13。详见 `verify/EASE_MATH.md`。

## 9. 参考资料

- 官方 Ease Presets 源码：`examples/Ease Presets.jsx`
- 官方 agents 指南的 “Scripts and ScriptUI windows” 节：`agents.md`
- plugins.md 的 “ScriptUI panels” / “Ease Presets” 节
- ScriptUI 实现：`source/scriptui.js`、`source/engine_scriptui.rs`、`source/scriptui_view.rs`
