# KCurve 1.0.0

给 **EffectCraft 0.13.0** 用的、类似 AE Flow / Kease 的可视化曲线工具（ScriptUI 脚本，单文件）。

当前版本：**1.0.0**。主版本只通过 **Window ▸ KCurve.jsx** 提供固定 **340×530** 的停靠
编辑器，不再安装 File ▸ Scripts 的浮动版。工具图标和整体布局已压紧，功能按钮保持一行。
- **单段模式**：把一条 cubic-bezier 曲线写到选中关键帧的入/出缓动上。
- **多点模式**：每个点就是一个关键帧；点 √ 后按首尾选中关键帧的比例把点写成时间线上的关键帧。
- 带分组胶囊式预设库。

![KCurve 面板](screenshots/single.png)

多点模式（每个点是一个关键帧，选中点才显示操纵杆）：

![KCurve 多点模式](screenshots/multi.png)

安装/升级说明见 [INSTALL.md](INSTALL.md)。

## 快速开始

```powershell
# 安装一次 ScriptUI 面板（Window 菜单里会出现 KCurve.jsx）
#   File ▸ Scripts ▸ Install ScriptUI Panel… → 选择 KCurve.jsx
#   之后每次从 Window ▸ KCurve.jsx 打开 340×530 的固定编辑器

# 开发/调试时也可以直接对着正在运行的 EffectCraft 跑
& 'C:\Program Files\EffectCraft\effectcraft-cli.exe' script 'D:\app edit\kcurve\KCurve.jsx' --bridge 9877
```

- 主版本是**停靠面板**，固定 preferredSize **340×530**，不拖边缩放。
- 因为 0.13 不把停靠区域实际尺寸告诉脚本，停靠区更小时宿主会出滚动条，
  更大时会留固定画布（详见 `KCURVE_NOTES.md` §6）。
- File ▸ Scripts 不再安装 KCurve；直接运行脚本只是开发调试入口，仍会开一个浮动窗口。

## 功能

### 1. 曲线编辑器（最上面）

- 二维平面：横轴时间 0–1，纵轴值 0–1。单段模式显示 `cubic-bezier(x1,y1,x2,y2)`，
  多点模式显示“N 个关键帧 + 当前点的时间/值”。
- **单段模式**：两个端点 + 贝塞尔拉杆，拖拉杆改缓动。
- **多点模式**：每个点就是一个关键帧，并且**有操纵杆**；为保持画面干净，只显示当前选中点的
  入/出拉杆，其他点只显示为圆点。每段曲线由前后点的拉杆直接决定。
- **允许超出边界**（链条图标）：链条**连接=关闭**（限制在 0–1），链条**断开=开启**，
  开启后可以拖出方框，视图自动扩展显示 overshoot。
- 实时预览：拖动时曲线和 canvas 立即重绘。

### 2. 从选中关键帧导入

- **选中 2 个相邻关键帧**时，点 **导入关键帧**（两个重叠方块图标）：读取 out/in 侧，
  按 Influence/Speed 反算 cubic-bezier 控制点。
- **选中 3 个及以上关键帧**时，同一按钮会把它们导入为**多点关键帧曲线**：
  每个选中键变成一个点，时间/值归一化到首尾键范围。
- 两个键、多组相邻键对时取所有相邻键对结果的平均值；状态栏会显示读取了几组。
  源码顶部有注释说明这个策略。
- 支持 Position（空间属性，沿运动路径的速度）和普通多维度属性（每维各自的速度）。
- Hold 侧、值不变的段会被跳过。

### 3. 预设库（下面）

- 组用**圆角矩形 chip** 表示，宽度随组名变化，横向排列并自动换行；点击 chip 切换组，
  拖动 chip 可以调整组的显示顺序。
- 当前组下方是**小正方形曲线预览 + 名称**的网格（参考 Flow）；点击预览加载曲线，
  右键可加载并应用、重命名、复制、删除。
- 内置组（Material 3 / 经典）内容**只读**，可以右键“复制到我的预设”后再改。
- 预设持久化在 `app.settings` 的 `KCurve/state`，即配置文件目录下的 `script_settings.json`。
  它是应用级数据，不随 `.ecproj` 项目文件走（和官方 Ease Presets 扩展一致）。
  没有桌面权限时脚本不能直接写文件，所以这是 0.13 唯一稳定的持久化方式。

### 4. 多点曲线

- 功能区的 **+** 把单段曲线用 de Casteljau 在中点切开：得到 3 个关键帧点，形状完全不变。
- 多点模式中的点可以左右拖（改时间）和上下拖（改值）；**选中点显示自己的入/出操纵杆**，
  拖杆改这一段曲线的切线，其他点不画拉杆。
- **−** 删除选中的中间点；首尾点不能删。删到只剩 2 个点会回到单段缓动模式。
- **平滑/折断**（S 形图标）：新建/切分出来的点默认**独立**，拖一侧时另一侧不会跟着甩；
  点 S 后该点左右拉杆才保持共线，再点回到折断。
- 多点模式应用时：以选中关键帧的**首尾键**为范围，每个点按 x 比例得到时间、
  按 y 比例得到首尾值之间的值；每段用该段的拉杆换算成入/出缓动。
  已存在的选中键会被替换，缺失的键会新增。

### 5. 实时修改开关

- **实时写入**（齿轮图标，空心=关，实心=开）关闭时：拖动只更新预览，点 **√** 才写入。
- 单段模式开启时：拖动拉杆/端点会立即写入当前选中关键帧；一次拖动是一个撤销步骤。
- 多点模式因为要新增/替换关键帧，拖动时只预览；点 **√** 才按点写入时间线。
- 齿轮的缺口标记按**面板重绘时间**推进；EffectCraft 0.13 的 GUI 不执行重复
  `app.scheduleTask`，所以面板空闲、不重绘时它不会自己转（见已知限制 7）。

### 6. 应用逻辑

- **单段模式**：入 / 出 / 入出 三种模式（左三角 / 右三角 / 菱形图标），默认“入出”。
- **多点模式**：每个点写成关键帧；每段用该段前后点的操纵杆换算成 ease
  （x1/x2 → influence，y 斜率 → 相对段平均速度）。
- 单段模式选中相邻关键帧对时，曲线第 k 段 → 第 k 个相邻键对（多出的键对复用最后一段）。
- 单个选中键时，出侧使用第一段，入侧使用最后一段（与官方 Ease Presets 的语义一致）。
- 写入 `KeyframeEase` 前会把关键帧时间按层 `stretch` 换算；空间属性用运动路径平均速度，
  普通属性每个维度各自缩放。Roving 键和 Hold 侧会跳过并在状态栏报数。
- 多点写入会**替换选中的键**（先删后加），这样拖动点改变时间时不会留下重复键；
  范围内未选中的键保持不动，状态栏会报告数量，曲线可能因此不完全贴合。
- 所有写入包在一个 `app.beginUndoGroup(...)` 里；实时拖动也是 mousedown→mouseup 一个撤销组。
- 注释里给了表达式方案作为二选一：本实现选择关键帧缓动，因为它不覆盖用户已有表达式，
  且已用 `verify/ease_math_probe.jsx` 数值验证可精确复现 cubic-bezier（误差约 1e-12）。

### 7. UI / 设计

- 功能栏最左边是语言按钮（地球图标），点开可选 **中文 / English**，选择保存在设置里。
- 功能区是简笔画图标行（参考 Kease）：
  - 两个重叠方块 = 从选中关键帧导入曲线
  - 链条（连接=限制在 0–1，断开=允许超出边界）
  - 齿轮（空心/实心）= 实时写入
  - **+ / −** = 添加/删除关键帧点
  - S 形 = 平滑/折断（仅多点）
  - ◁ / ▷ / ◆ = 入 / 出 / 入出（仅单段）
  - **✓** = 应用/写入
- 预设区参考 Flow：组是自适应宽度的圆角 chip、横向排列；预设是小正方形曲线预览，
  名称在下方。保存、新建组仍是胶囊按钮。窄窗口时工具栏会分两行（工具一行、模式+✓ 一行）。
- 颜色跟随 EffectCraft 的 `appearance.theme`（dark / darker / light），在打开时和每次按下
  鼠标时重新读取；切主题后点一下面板即可刷新。文本由宿主用 EffectCraft 的 UI 字体绘制，
  脚本只控制字号/对齐（ScriptUI 的字体 family 在 0.13 里不会生效）。
- 支持最小 380×600、最大 2400×2000 的窗口尺寸；曲线坐标按画布比例映射。

## 文件

| 路径 | 说明 |
|---|---|
| `KCurve.jsx` | 主脚本（单文件，安装到 ScriptUI Panels，当前 1.0.0） |
| `releases/KCurve-1.0.0.jsx` | 1.0.0 发布版快照 |
| `releases/KCurve-0.99.4.jsx` | 0.99.4 性能版快照 |
| `releases/KCurve-0.99.3.jsx` | 0.99.3 中英双语版快照 |
| `releases/KCurve-0.99.2.jsx` | 0.99.2 固定停靠版快照 |
| `releases/KCurve-0.99.1.jsx` | 0.99.1 固定停靠版快照 |
| `releases/KCurve-0.99.jsx` | 0.99 紧凑版快照 |
| `releases/KCurve-0.98.1.jsx` | 0.98.1 固定停靠版快照 |
| `releases/KCurve-0.98.jsx` | 0.98 版快照 |
| `releases/KCurve-0.97.jsx` | 0.97 版快照 |
| `releases/KCurve-0.96.jsx` | 0.96 版快照 |
| `releases/KCurve-0.95.jsx` | 0.95 版快照 |
| `releases/KCurve-0.94.jsx` | 0.94 版快照 |
| `releases/KCurve-0.93.jsx` | 0.93 版快照 |
| `releases/KCurve-0.92.jsx` | 0.92 版快照 |
| `releases/KCurve-0.91.jsx` | 0.91 版快照 |
| `releases/KCurve-0.90.jsx` | 0.90 版快照（基线） |
| `CHANGELOG.md` | 版本记录 |
| `README.md` | 本文件 |
| `LICENSE` | MIT |
| `docs/effectcraft/` | 官方脚本/控制协议文档、官方示例、ScriptUI 源码快照、可行性笔记 |
| `docs/effectcraft/KCURVE_NOTES.md` | 实测 API 速查、缓动换算公式、平台限制 |
| `docs/kcurve-panel.png` | 面板截图 |
| `verify/ease_math_probe.jsx` | 独立的缓动数学验证脚本（headless） |
| `verify/EASE_MATH.md` | 验证结果、公式、边界情况 |

## 已知限制

1. **停靠面板拿不到实际尺寸**：EffectCraft 0.13 的 `scriptui_view.rs::panel()` 在宿主侧
   按实际停靠区域布局，但脚本的 `onDraw` 仍按 preferredSize 生成 draw list。因此停靠版
   只能是固定 preferredSize 的完整编辑器（0.98.1 起）；官方安装版不再提供浮动窗口。
2. 开发调试用的浮动回退窗口只能拖**右 / 下 / 右下**边缘缩放；正式安装版是固定面板。
3. 没有鼠标滚轮事件支持：EffectCraft 0.13 只把 mousedown/move/up 等六种鼠标事件发给脚本。
   预设列表用右侧加宽的自定义滚动条拖动，或在列表空白处按住上下拖动来滚动。
4. `cubic-bezier` 的 x1=0 / x2=1 在 AE 缓动里不可精确表示（influence 0 会被拒绝）；
   写入时用 0.001/0.999 近似，误差约 2.4e-3（归一化），状态栏会提示。
5. 多点写入会替换**选中的**关键帧；如果首尾范围里还有未选中的键，它们不会被删除，
   曲线可能不贴合，状态栏会提示。
6. 多点模式的“实时写入”只做预览（因为拖一下就要增删键），点 **✓** 才写时间线。
7. **没有脚本定时器**：EffectCraft 0.13.0 的 GUI 实测不回调重复 `app.scheduleTask`
   （浮窗和停靠面板都试过，`script.runTasks` 也报 “scripting is not available in this build”）。
   因此齿轮只在面板重绘时按时间旋转，组折叠是即时的；做不了真正的逐帧旋转/展开动画。
7. ScriptUI 不能写文件；预设只能存在 `app.settings`（应用级），不能导出 JSON 文件。
8. 内置预设只读；要改就先“复制到我的预设”。
9. 没有键盘快捷键、没有多选预设批量操作、没有撤销 UI 按钮（用 EffectCraft 自己的撤销）。

## 验证

```powershell
# 数学验证（headless，构建自己的测试 comp）
& 'C:\Program Files\EffectCraft\effectcraft-cli.exe' script 'D:\app edit\kcurve\verify\ease_math_probe.jsx' --empty --json
```

实测（live app + headless）：

- Opacity 0→100 @1s，写入 `cubic-bezier(0.42,0,0.58,1)` 后采样误差 < 1e-3，回读精确；
- Position（Spatial）单侧 ease 写入/回读一致；
- 单段转多点：切分后曲线形状不变（拉杆精确来自 de Casteljau）；删回 2 点恢复原 cubic；
- 多点模式：2 个选中键 + 3 个点 → 在 50% 时间新增 value=50 的关键帧；
  拖动中间点到 t=0.54/v=0.75 后再次应用 → 键移动到新时间，没有重复键；
- 3 个关键帧选中时点导入 → 3 个点，时间/值归一化正确；
- 主题 dark/light 切换、窗口拖边缘缩放（600→384→704）、预设保存/点击、分组滚动均通过。

## License

MIT。缓动换算思路来自 EffectCraft 官方 Ease Presets 扩展（MIT OR Apache-2.0，作者
EffectCraft contributors）；相关官方文档与源码快照保留其原始许可。










