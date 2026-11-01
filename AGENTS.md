# KCurve 项目工作约定

本文件是用户给 agent 的长期约定，后续会话按此执行。

## 版本号

- **每做一次修改，版本号 +0.0.1**（1.0.1 → 1.0.2 → 1.0.3 …），不要等打包时才改。
- 同步更新：`KCurve.jsx` 头部注释、`KCURVE_VERSION`、`README.md` 的「当前版本」、
  `INSTALL.md` 标题，并在 `CHANGELOG.md` 顶部加一条（日期用当天）。
- `releases/`、`KCurve-<version>.jsx` 快照和 `dist/` 打包产物**不在每次修改时动**。

## 每次修完必须装到 EffectCraft

改完 `KCurve.jsx` 后，直接把文件复制到本机已装的 ScriptUI 面板目录：

```powershell
Copy-Item 'D:\app edit\kcurve\KCurve.jsx' "$env:APPDATA\EffectCraft\Scripts\ScriptUI Panels\KCurve.jsx" -Force
```

- 目标文件：`C:\Users\<用户名>\AppData\Roaming\EffectCraft\Scripts\ScriptUI Panels\KCurve.jsx`
- 面板在 **Window ▸ KCurve.jsx** 打开；EffectCraft 正在运行时要重开面板（或重启应用）才会加载新版本。
- 复制后核对 SHA256/文件大小，确认装的是刚改的版本。

## 打包

- **不要自行打包**（不更新 `dist/`、`releases/`、不建 tag、不发 Release），等用户明确说「打包」再做。
- 用户说打包时，按 `docs/PUBLISH_TO_GITHUB.md` 的流程走。

## 验证

- 数学/引擎层：`verify/ease_math_probe.jsx`、`verify/multipoint_probe.jsx`（headless 即可跑）。
- UI 端到端：`verify/e2e_setup.jsx` + `verify/e2e_read.jsx`，配合
  `effectcraft.exe --control <port>` 和 `scriptui.mouse` 模拟点击/拖拽。
- 改脚本后至少跑一次 `node --check`（Node 路径见会话环境）做语法检查。

## AI 署名

- **AI 参与的提交**，在提交信息末尾加一行共作者署名（GitHub 会据此把 AI 计入仓库贡献者）：

  ```
  Co-authored-by: DeepSeek <350922609+deepseek-kg1@users.noreply.github.com>
  ```

- 只标确有 AI 参与的提交；纯手工提交不加。
- 署名不改变 Git 作者：作者始终是
  `KOGGUA-EDIT <290471474+KOGGUA-EDIT@users.noreply.github.com>`，也不要拿它替代 `Signed-off-by`。
- AI 的专属 GitHub 账号是 [@deepseek-kg1](https://github.com/deepseek-kg1)，上面那串就是它的
  noreply 地址（`<ID>+<username>@users.noreply.github.com`）。别换成真实邮箱，避免把邮箱写进公开历史。
