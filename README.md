# dsh-terminal

DeepSeek Harness Desktop 的独立终端插件。在左栏 **Maid** 下方选择 **terminal**，打开当前 Mac 上的交互式终端。

## 安装

适用于 macOS 上的 DSH Desktop `0.2.2-rc.5` 或兼容的后续 `0.2.x` 版本。用 DSH Desktop 自带的 CLI 从 [GitHub Release](https://github.com/ceasarXuu/dsh-terminal/releases/latest) 安装到 `desktop` profile。

```sh
dsh plugin --profile desktop add https://github.com/ceasarXuu/dsh-terminal/releases/download/v0.2.0/ceasarxuu-dsh-terminal-0.2.0.tgz --save-exact --ignore-scripts
```

如果终端里的 `dsh --version` 指向旧版，可以使用 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` 执行同一个命令。若已运行的 Desktop 未显示入口，在桌面任务结束后正常重启 DSH。

## 使用

- **New Terminal** 在用户主目录打开终端。安装 tmux 后，新标签就是原生 tmux 窗口。没有 tmux 时，仍可打开普通 shell。
- **Tabs on Left** 将标签栏移到左侧，**Tabs on Top** 移回顶部。
- 将一个 tmux 标签拖到另一张画布中的窗格边缘，tmux 会把来源窗口的当前窗格移过去。拖分隔线调整宽高，也可以使用 tmux 自己的快捷键和窗格菜单。窗格数量由 tmux 和窗口尺寸决定。
- **Break Pane** 将当前窗格拆回一个新标签，进程继续运行。关闭由插件新建的 tmux 标签会关闭对应的 tmux 窗口及其窗格。
- **Connect tmux** 列出本机 tmux 默认服务上的会话。选择会话后进入现有终端。关闭这个标签只断开插件的客户端，原 tmux 会话继续运行。tmux 由用户在 Mac 上安装。

DSH 画布使用按 profile 隔离的 tmux 服务，可以在重开 DSH 后接着用。通过 **Connect tmux** 接入的外部会话使用它自己的服务和布局。

插件通过 DSH 的本机浏览器认证访问终端。终端输入和输出只在运行中的桌面宿主和界面中处理。

## 构建

```sh
pnpm install --frozen-lockfile
pnpm run build
npm pack
```

`scripts/check-desktop.mjs` 使用 DSH Web 宿主的启动 URL 验证发布包的终端行为。设置 `DSH_TERMINAL_CHECK_CANVAS=1` 可检查原生分屏，设置 `DSH_TERMINAL_CHECK_TMUX=1` 可检查外部 tmux 接入。两项都应使用独立的测试 profile 和 `TMUX_TMPDIR`，并让宿主和脚本使用同一个目录。
