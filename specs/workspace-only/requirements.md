# 只在有工作区的对话里出现：需求

在「用 VSCode 打开」插件上做增量：**没有工作区（临时会话）时，插件在界面上什么都不显示**。

## 背景

0.6.0 开发期间试过两条临时会话的路子，都被真机否定：

1. 插件自己拼 `<应用数据目录>/scratch/<会话 id>`：点击那一刻插件拿不到当前会话 id（宿主事实见 `design.md`），用户切过会话就会打开**另一个会话**的目录。
2. 把写死的 `/vscode-here` 填进输入框，交给宿主的 Agent 扩展在「会话工作目录」里打开：扩展的 cwd 是 `projectPath ?? process.cwd()`，临时会话没有项目根，于是落到 sidecar 进程目录（本机是 `/`），扩展只能取消。已据此提了 [vastsa/PI-Desktop#1459](https://github.com/vastsa/PI-Desktop/issues/1459)。

结论：本版不再给临时会话任何入口，只保留能确定的那一条——**有工作区就打开项目根**。临时会话要能用，得等宿主把会话目录交出来（#1459）或给插件一个只读入口（[vastsa/PI-Desktop#993](https://github.com/vastsa/PI-Desktop/issues/993)）。

## 目标

- **有工作区**（`pi.workspace.get()` 给出项目根）：输入框按钮、角落按钮、`/vscode` 命令都直接打开它。
- **没有工作区**（临时会话）：插件不显示任何界面元素——不画输入框按钮、不挂角落按钮、也不给替代命令——并且不做任何目录推断。
- 按钮画出来之前先探测一次；探测不出「有工作区」就不画。

## 验收

- 探测：插槽挂载时派发一次 `plugin.call`，`method` 为 `hasWorkspace`；只有返回 `hasWorkspace: true` 才画按钮并开角落层，`false` 或宿主拒绝都不画、不开层；这一次探测不拉起任何外部命令。
- 有项目根时：探测为 `true`；点按钮或跑 `/vscode` 用 `open -a "Visual Studio Code"` 打开项目根，toast 仍是「已用 VSCode 打开」。
- 没有项目根时：探测为 `false`，界面里没有按钮，也没有角落层；命令入口的提示是「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」，并且**一次都不 spawn**。
- 会话切走（按钮已画出来、渲染器收不到通知）后点一次按钮：`openWorkspace` 返回 `NO_PROJECT_ROOT`，渲染器转成 `NO_SESSION_DIR`，收掉角落按钮，并在输入框那一行留一句「本次对话没有工作区（临时会话），这个按钮已隐藏。」；下一次插槽挂载不再画按钮。
- 插件不再往输入框里填任何命令：`rendererActions` 里没有 `composer.insertText` / `composer.readDraft`，一次点击最多派发一次 `plugin.call`。

## 约束

- 只读一次 `pi.workspace.get()`；不读文件系统、不拼路径、不枚举目录、不碰剪贴板。
- 渲染器只用一个动作 `plugin.call`；方法名必须列在 `manifest.rendererCallMethods`（`hasWorkspace` / `openWorkspace`）。
- 渲染器模块必须是无构建 ES 模块，不能用 JSX、不能依赖 npm 包（宿主只提供 `react` / `react-dom`）。
- 角落按钮的文案 en / zh-CN 两份。

## 不做

- 不猜临时会话的目录（本轮的核心决定）。
- 不给临时会话任何替代入口（不再往输入框填命令，也不再指向别的命令）。
- 不为「切会话」订阅任何事件：宿主没给这类通知，改用「挂载时探测 + 点击时发现」两条兜住。
- 不引入依赖、不加构建步骤、不新增权限。
