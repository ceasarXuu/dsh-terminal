# dsh-terminal

DeepSeek Harness Desktop 的独立终端插件。在左栏 **Maid** 下方选择 **terminal**，打开当前 Mac 上的交互式终端。

## 安装

适用于 macOS 上的 DSH Desktop `0.2.2-rc.5` 或兼容的后续 `0.2.x` 版本。用 DSH Desktop 自带的 CLI 从 [GitHub Release](https://github.com/ceasarXuu/dsh-terminal/releases/latest) 安装到 `desktop` profile。

```sh
dsh plugin --profile desktop add https://github.com/ceasarXuu/dsh-terminal/releases/download/v0.1.0/ceasarxuu-dsh-terminal-0.1.0.tgz --save-exact --ignore-scripts
```

如果终端里的 `dsh --version` 指向旧版，可以使用 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` 执行同一个命令。若已运行的 Desktop 未显示入口，在桌面任务结束后正常重启 DSH。

## 使用

- **New Terminal** 在用户主目录打开系统默认 shell。点击标签切换会话。终端在返回 DSH 其他面板后继续运行，再打开时恢复当前屏幕和最近的输出。
- **Tabs on Left** 将标签栏移到左侧，**Tabs on Top** 移回顶部。
- **Connect tmux** 列出本机 tmux 默认服务上的会话。选择会话后进入现有终端。关闭这个标签只断开插件的客户端，原 tmux 会话继续运行。tmux 由用户在 Mac 上安装。
- 关闭普通 shell 标签会结束该终端。普通 shell 的生命周期由 DSH 宿主管理。宿主退出时，独立 tmux 服务器仍可继续运行。

插件通过 DSH 的本机浏览器认证访问终端。终端输入和输出只在运行中的桌面宿主和界面中处理。

## 构建

```sh
pnpm install --frozen-lockfile
pnpm run build
npm pack
```

`scripts/check-desktop.mjs` 使用 DSH Web 宿主的启动 URL 验证发布包的终端行为。它新建并关闭自己的测试会话。tmux 验证使用独立的 `TMUX_TMPDIR`，并要求宿主和脚本使用同一个目录。
