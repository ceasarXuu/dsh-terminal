# dsh-terminal

DeepSeek Harness Desktop 的独立终端插件。在左栏选择 **终端**（**Terminal**），打开当前 Mac 上的交互式终端。插件界面跟随 DSH 的语言设置。

## 安装

适用于 macOS 上的 DSH Desktop `0.2.3-alpha.2` 或兼容的后续 `0.2.x` 版本。用 DSH Desktop 自带的 CLI 从 [GitHub Release](https://github.com/ceasarXuu/dsh-terminal/releases/latest) 安装到 `desktop` profile。

```sh
dsh plugin --profile desktop add https://github.com/ceasarXuu/dsh-terminal/releases/download/v0.2.4/ceasarxuu-dsh-terminal-0.2.4.tgz --save-exact --ignore-scripts
```

如果终端里的 `dsh --version` 指向旧版，可以使用 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` 执行同一个命令。若已运行的 Desktop 未显示入口，在桌面任务结束后正常重启 DSH。

## 使用

- **新建终端**在用户主目录打开一个普通 shell（`$SHELL`）。每个标签是一个独立的终端，关闭标签会结束其中的进程。
- **标签栏移到左侧**和**标签栏移到顶部**可以调整标签栏位置。
- 标签栏支持方向键、Home/End 切换标签。
- 需要 tmux 等多路复用器时，直接在终端里运行 `tmux`；插件不代开、也不接管 tmux 会话。

插件通过 DSH 的本机浏览器认证访问终端。终端输入和输出只在运行中的桌面宿主和界面中处理。

## 构建

```sh
pnpm install --frozen-lockfile
pnpm run build
npm pack
```

`scripts/check-desktop.mjs` 使用 DSH Web 主机的启动 URL 验证发布包的终端行为：创建、流式输出、重连快照、缩放、Ctrl-C、关闭与授权。应使用独立的测试 profile 运行。
