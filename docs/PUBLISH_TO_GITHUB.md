# 发布 KCurve 到 GitHub

这份指南用 **GitHub Desktop** 或命令行都可以。发布包已经生成：

`dist/KCurve-1.0.0.zip`

## 一、创建空仓库

1. 登录 https://github.com
2. 右上角 **+ ▸ New repository**
3. 名字填 `KCurve`
4. 选择 **Public**
5. 不要勾选 “Add a README file”，仓库保持空
6. 创建后记下地址，例如：

   `https://github.com/你的用户名/KCurve.git`

## 二、第一次提交（命令行）

在项目目录打开 PowerShell：

```powershell
cd "D:\app edit\kcurve"

git init
git config user.name "你的名字"
git config user.email "你的邮箱"
git add KCurve.jsx README.md CHANGELOG.md LICENSE INSTALL.md .gitignore docs releases
git commit -m "KCurve 1.0.0"
git branch -M main
git remote add origin https://github.com/你的用户名/KCurve.git
git push -u origin main
```

如果提示登录，按 GitHub 的浏览器授权或使用 Personal Access Token。

### 不想用命令行

1. 安装 **GitHub Desktop**。
2. `File ▸ Add local repository`，选择 `D:\app edit\kcurve`。
3. 填提交信息 `KCurve 1.0.0`，点 **Commit to main**。
4. 点 **Publish repository**，选择 Public。

## 三、发布 1.0.0 Release

1. 打开仓库页面，右侧 **Releases ▸ Create a new release**。
2. Tag 填 `v1.0.0`，标题填 `KCurve 1.0.0`。
3. 上传：

   `D:\app edit\kcurve\dist\KCurve-1.0.0.zip`

4. 描述里写更新内容（可直接复制 CHANGELOG 的 1.0.0 段）。
5. 点 **Publish release**。

### 用 GitHub CLI 也可以

```powershell
gh release create v1.0.0 "D:\app edit\kcurve\dist\KCurve-1.0.0.zip" `
  --title "KCurve 1.0.0" `
  --notes "KCurve 1.0.0"
```

## 四、以后更新版本

1. 修改 `KCurve.jsx` 里的 `KCURVE_VERSION` 和 README/CHANGELOG。
2. 重新打包并测试。
3. 提交：

```powershell
git add -A
git commit -m "KCurve 1.0.1"
git push
```

4. 再创建一个新 tag/Release，例如 `v1.0.1`，上传新的 zip。

## 五、不要提交的东西

`.gitignore` 已经忽略：

- `.ec-config-*` 测试配置
- `.tmp/` 临时文件
- `dist/` 发布包
- 日志文件

`dist` 里的 zip 只作为 Release 附件上传，不需要进入仓库。

## 六、检查清单

- [ ] README 截图能显示
- [ ] `KCurve.jsx` 能在干净的 EffectCraft 配置里安装
- [ ] 语言按钮能切中/英
- [ ] Release 附件能下载并解压
- [ ] LICENSE 是 MIT
## 推送时报 SEC_E_NO_CREDENTIALS

这说明 Git 还没有保存 GitHub 登录凭据，不是仓库或代码的问题。

最简单的三种办法：

### 方法 A：GitHub Desktop

1. 安装并登录 GitHub Desktop。
2. `File ▸ Add local repository`，选择 `D:\app edit\kcurve`。
3. 点右上角 **Push origin**。
4. 按提示登录 GitHub。

### 方法 B：Git Credential Manager

在普通 PowerShell/Git Bash 里执行：

```powershell
git config --global credential.helper manager
git push -u origin main
```

会弹出浏览器登录 GitHub；登录完成后会自动保存凭据。

### 方法 C：Personal Access Token

1. GitHub：`Settings ▸ Developer settings ▸ Personal access tokens` 创建 token，勾选 `repo`。
2. 推送时用户名填 GitHub 用户名，密码填 token。

不要把 token 写进 README、脚本或提交记录。

