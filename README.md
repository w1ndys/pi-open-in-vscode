# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：立刻用 Visual Studio Code 打开当前工作目录。

仓库：https://github.com/w1ndys/pi-open-in-vscode

## 使用

1. 安装或加载本插件。
2. 打开一个项目。
3. 任选一种立刻打开（不再经过侧边栏页面）：
   - 命令面板搜「用 VSCode 打开当前工作目录」
   - 输入框输入 `/vscode` 回车

打开顺序：macOS `open -a "Visual Studio Code"` → `code`。

## 做不到的

PI-Desktop 的插件接口**不能**往输入框下面那一行（发送、模型、上下文长度、工作模式、编辑模式）插按钮。那一行是宿主自己的控件，没有 `contributes` 扩展点。本插件只能提供命令 / 斜杠命令。

## 检查

```bash
npm run check
```

## 权限

只声明 `notify`（低风险），用于打开成功 / 失败的提示。不读文件、不写文件、不访问网络、不碰剪贴板。

## 市场

已上架：https://plugins.aiuo.net/plugins/io.github.w1ndys.pi-open-in-vscode

在 PI-Desktop 的 **Plugins → Marketplace** 里搜「用 VSCode 打开」即可安装。

## 权限

只声明 `notify`（低风险），用于打开成功 / 失败的提示。不读文件、不写文件、不访问网络、不碰剪贴板。

## 重新发布

改 `version` → 提交推送 → 打新标签 → MCP 调 `submit_version`。
完整流程与踩过的坑见 [docs/发布说明.md](docs/发布说明.md)。
