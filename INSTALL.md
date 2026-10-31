# KCurve 2.0.0 安装

## 安装固定面板

1. 关闭 EffectCraft。
2. 打开：

   `C:\Users\<你的用户名>\AppData\Roaming\EffectCraft\Scripts\ScriptUI Panels`

3. 把 `KCurve.jsx` 复制进去。
4. 启动 EffectCraft。
5. 从菜单 **Window ▸ KCurve.jsx** 打开。

面板会**跟着停靠区自动重排**（**EffectCraft 0.19.0 专属**）；最小布局 200×300，比这更小才出现滚动条。
旧版 EffectCraft（0.13–0.18）**未测试，不保证可用**；停靠自适应和稳定运行只针对 0.19.0 验证过。

## 升级

直接用新 `KCurve.jsx` 覆盖旧文件，然后重启 EffectCraft。语言、预设和设置保存在
`app.settings`，不会因为覆盖脚本而丢失。

## 卸载

删除 `Scripts\ScriptUI Panels\KCurve.jsx`，重启 EffectCraft。

## 注意

- 不要把 KCurve 同时放进 `Scripts\KCurve.jsx`；2.0.0 只保留 ScriptUI Panels 入口，避免出现两个版本。
- 首次打开会读取 EffectCraft 的界面语言；之后可以选择中文或 English，选择会记住。

