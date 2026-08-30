# DeepSeek Harness Desktop（dsh-desktop）

Windows 桌面外壳：常驻托盘、随机端口拉起 `dsh web` 内核、Splash 美化、单实例锁、开机自启、GitHub Releases 自动更新、基础插件市场。

## 开发

```bash
npm install --legacy-peer-deps
npm run icon      # 生成占位图标（正式图标直接替换 assets/ 下同名文件）
npm start         # 开发运行：随机端口拉起内核
npm start -- --silent   # 静默启动：只进托盘不开窗
```

## 打包

```bash
npm run dist      # 两段式打包：--dir 出 win-unpacked → 注入完整 dsh 内核树 → --prepackaged 压 NSIS
```

- 输出：`dist/DeepSeek Harness Desktop-Setup-<version>.exe`（NSIS 安装版）
- 内核树不走 electron-builder 的依赖图复制（它会拍扁嵌套 node_modules，破坏内核 ESM 解析），
  由 `scripts/build.js` 在打包后原样注入 `resources/dsh`
- 安装包自带 `resources/node/node.exe`（构建机的 node 会被打进包），目标机器无需装 Node
- 构建时如 GitHub 下载超时，设置镜像：
  `$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`

### 同步内核树（重要）

本项目 node_modules 里的 `@deepseek-ai/dsh` 是从本机全局安装**整体复制**的完整树（含嵌套
node_modules 与 koffi/node-pty 预编译产物）。npm 的普通安装（即使 --legacy-peer-deps）产出的
树不完整，内核会报 `ERR_MODULE_NOT_FOUND`。升级 dsh 版本时，先全局 `npm i -g @deepseek-ai/dsh@<ver>`，
再 robocopy 全局 `node_modules\@deepseek-ai\dsh` 到本项目 `node_modules\@deepseek-ai\dsh`。
CI 工作流里已内置同样步骤。

## 配置与日志

- 用户配置：`%APPDATA%/dsh-desktop/config.json`
  - `harnessHome`：内核数据目录（`DSH_HOME`），默认 `%USERPROFILE%\.dsh`，即沿用已有预设和会话
- 日志：`%APPDATA%/dsh-desktop/logs/main.log`

## 发布与自动更新

1. 在 GitHub 创建仓库 `dsh-desktop`（owner 已配置为 `jiayu6153-gif`）
2. 推送代码并打 tag：

```bash
git init && git add -A && git commit -m "v0.1.0"
git remote add origin https://github.com/jiayu6153-gif/dsh-desktop.git
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0
```

3. 打 tag 后 GitHub Actions 自动构建并发布 Release（`.github/workflows/release.yml`）
4. 打包版启动 15 秒后自动静默检查更新，下载完托盘通知、退出时自动安装（开发模式不检查）

## 插件市场

- 清单 JSON 格式（市场页底部有说明）：

```json
{
  "name": "官方市场",
  "plugins": [
    {
      "id": "my-preset",
      "name": "我的预设",
      "description": "说明",
      "version": "1.0.0",
      "type": "preset",
      "url": "https://example.com/my-preset.zip"
    }
  ]
}
```

- v0.1 支持 `type: preset`：下载 zip 解压到 `<harnessHome>/.agent-presets/<id>/`
- 安装后需托盘「暂停内核」→「启动内核」重新加载生效
- 建议把市场清单放 `https://github.com/jiayu6153-gif/dsh-market`，页面默认源已指向它
