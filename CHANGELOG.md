# 变更记录

## 0.6.1

- Windows 不再调用 `/usr/bin/open`，也不再 spawn 无扩展名的 `code`。那个文件是 shell 脚本，Node 会先命中它，于是已安装也会提示「请确认已安装」。现在先定位 `Code.exe`（PATH 中的 `code.cmd`、默认安装目录、注册表），找不到再显式启动 `code.cmd`。直接拉起 `Code.exe` 时去掉继承来的 `ELECTRON_RUN_AS_NODE`。

## 0.6.0

- **新增跨插件的「右下角按钮带」约定**：角落按钮带 `data-pi-corner-button` 标记；同窗口里所有这类按钮按 DOM 顺序从右下角往上排，靠后的按下面几颗按钮的高度用 `transform: translateY()` 让位，只改绘制不改布局，别家量到的仍是真实高度。起因是真机上和 `pi-open-git-web` 的角落按钮叠在了一起——宿主没有角落槽位，每个插件都用 `pi.ui.openLayer()` 各自往右下角画，位置只能插件之间自己约定。
- **只剩窗口右下角的角落按钮**：输入框那一行的按钮去掉（按用户要求），斜杠命令与命令面板保留。三条入口共用同一条打开路径与同一句提示。
- 按钮改成**盯 DOM 决定显示**：宿主渲染出输入框（`.composer-shell`）且该输入框确实露在屏幕上（中心点做一次命中测试）才画；离开对话界面（设置页、定时任务页、插件页，或输入框消失）立刻收起。模块因此不再注册任何插槽、也不再依赖 react，只用 `MutationObserver` 盯 DOM 变化并合并成一次检查，另外在加载时清掉上一次残留的层。
- 不再靠插槽判断页面的原因（读宿主代码 + 真机确认）：自绘层挂在窗口上、不随页面切换消失；而切到设置页时对话框的 DOM 仍挂在树上（只是被设置页盖住），插槽的卸载回调根本不触发；切到定时任务页/插件页虽然会卸载对话框，但热重载留下的旧层已经没人能关。两条都会让按钮出现在非对话页面上。
- 打开位置的规则收成一条：**只认当前项目根**。拿得到时按钮与 `/vscode` 命令直接打开它；拿不到（临时会话）就不显示按钮，也不做任何目录推断。
- 画按钮前先探测一次：渲染器派发 `plugin.call` 的 `hasWorkspace`（插件主进程只读一次 `pi.workspace.get()`），只有明确返回「有工作区」才画；探测为否或探测失败都不画。按钮没显示期间最多每 1.5 秒重新问一次，切回有工作区的会话时能自己回来；会话切走、按钮还在时点一次，会先把原因留在按钮上，稍后再把按钮收掉。
- `/vscode` 命令在没有工作区的会话里只说一句「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」，一次外部命令都不拉起来。
- 撤掉上一版试过的临时会话交接：把 `/vscode-here` 填进输入框、交给宿主的 Agent 扩展解析目录——真机证明扩展同样拿不到会话 scratch（扩展 cwd 是 `projectPath ?? process.cwd()`，临时会话落到系统根 `/`）。`manifest.rendererActions` 随之收回只剩 `plugin.call`，`composer.insertText` / `composer.readDraft` 不再声明。
- 摘掉 Agent 扩展与 `agent.extension` 权限（删 `extension.mjs` 与它的单测）：那条路在临时会话里拿到的是系统根、只能取消，在有工作区的对话里又与 `/vscode` 完全等效，却要一个能在 Agent sidecar 内执行命令的重权限。等 [vastsa/PI-Desktop#1459](https://github.com/vastsa/PI-Desktop/issues/1459) 落地、扩展真能拿到会话目录时再加回来。`manifest.permissions` 现在只剩 `renderer.extension` 与 `notify`，`contributes` 只剩 `commands`。
- 删除整层会话目录推断：「定位会话工作目录」那份数据层实现、业务层挑目录的纯函数与对应的回合结束事件监听全部移除，对应单测也删掉；渲染器测试的 react 桩与解析钩子（`test/fixtures/`）也一并删掉，因为渲染器不再用 react。
- 规格仍是 `specs/workspace-only/`（旧的 `specs/session-open/` 描述的是已被撤掉的交接）；`npm run check` 共 54 项，3 个测试文件。

## 0.5.0

- 新增窗口右下角的常驻按钮（自绘层）：点一次就打开，盒子铺满视口但只有按钮吃点击，不挡下面的内容。
- 输入框右侧按钮与 `/vscode` 命令保留；三种入口共用 `openAnnounce` 那条路径，成功/失败提示同一句话。
- 角落按钮的文案表带 en / zh-CN 两份，按应用语言选，界面上不留写死的可见文案。
- 去掉 0.5.0 开发期间的独立浮窗按钮方案（`ui.panel` + `ui.shape: "widget"`）：宿主不提供窗口坐标，也不给移动通道，窗口只能落在屏幕正中、且位置不持久化。相关文件与 `ui.panel` 权限一并移除。
- `npm run check` 覆盖 `renderer/corner.mjs`；渲染器测试新增角落按钮与自绘层用例。

## 0.4.0

- 输入框工具条右侧新增「VSCode」按钮，点一次就打开当前工作目录（`renderer.extension` + `composerControl` 插槽）。
- 斜杠命令 `/vscode` 保留不变，两条入口共用 `openCurrentWorkspace`，成功/失败提示同一句话。
- 按钮通过 `plugin.call` 调 `openWorkspace`；`executeOpenPlan` 与 `openCurrentWorkspace` 支持注入执行器，便于单测。
- 新增渲染器模块单测与主进程入口单测；`npm run check` 同时检查 `.mjs`。
- 本版为本地开发加载版：插件中心发布接口不接受 `renderer` 字段，上架版本仍需去掉这些字段。

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
