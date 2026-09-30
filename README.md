# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：在右侧工作面板点一个按钮，用 Visual Studio Code 打开当前工作目录。

仓库：https://github.com/w1ndys/pi-open-in-vscode

文件管理器商店包没有视图源码，所以做成独立插件，不改已安装的 `pi.file-manager`。

## 使用

1. PI-Desktop → Plugins → Load development plugin → 选择本目录。
2. 打开一个项目。
3. 右侧工作面板 → 插件视图 →「用 VSCode 打开」。
4. 点按钮。也可以用命令「用 VSCode 打开当前工作目录」。

打开顺序：`vscode://file` 协议 → `code` 命令 → macOS `open -a "Visual Studio Code"`。

## 检查

```bash
npm run check
```
