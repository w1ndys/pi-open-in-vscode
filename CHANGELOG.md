# 变更记录

## 0.3.0

- 补齐插件中心要求的 `i18n.en` / `i18n.zh-CN` `safetyNotes`（i18n 门禁必需的字段）。
- 命令补上 `keywords` 与 `category`，方便在命令面板搜到。
- 声明 `notify` 权限，用于打开成功或失败后的提示。
- 补上 `license`、`homepage`、顶层 `safetyNotes`、`changelog`。

## 0.2.0

- 去掉侧边栏页面，改成一条命令（`/vscode`）立刻打开，只操作一次。
- 不再走 `vscode://` 协议，改为直接拉 `open -a "Visual Studio Code"`，失败再试 `code`。
- 去掉 `shell.openExternal` 与 `ui.view` 权限。

## 0.1.0

- 首个版本：右侧工作面板里一个按钮，打开当前工作目录。
