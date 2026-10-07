# 变更记录

## 0.6.0

- 打开位置的规则收成一条：**只认当前项目根**。拿得到（有工作区的会话）时，输入框按钮、角落按钮与 `/vscode` 命令都直接打开它；拿不到（临时会话）时插件**整个不出现**——不画按钮、不挂角落按钮，也不做任何目录推断。
- 按钮画出来之前先探测一次：渲染器派发 `plugin.call` 的 `hasWorkspace`（插件主进程只读一次 `pi.workspace.get()`），只有明确返回「有工作区」才画按钮、才开角落按钮那一层；探测为否或探测失败都不画。会话切走之后按钮不会自己消失（渲染器拿不到切换通知），这种时候点一次会失败，按钮随即撤掉并留一句说明。
- 撤掉上一版试过的临时会话交接：把 `/vscode-here` 填进输入框、交给宿主的 Agent 扩展解析目录——真机证明扩展同样拿不到会话 scratch（扩展 cwd 是 `projectPath ?? process.cwd()`，临时会话落到系统根 `/`）。`manifest.rendererActions` 随之收回只剩 `plugin.call`，`composer.insertText` / `composer.readDraft` 不再声明；角落按钮的「已填入」状态与相应用例一并删掉。
- `/vscode` 命令在没有工作区的会话里只说一句「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」，一次外部命令都不拉起来。
- 摘掉 Agent 扩展与 `agent.extension` 权限（删 `extension.mjs` 与它的单测）：那条路在临时会话里拿到的是系统根、只能取消，在有工作区的对话里又与 `/vscode` 完全等效，却要一个能在 Agent sidecar 内执行命令的重权限。等 [vastsa/PI-Desktop#1459](https://github.com/vastsa/PI-Desktop/issues/1459) 落地、扩展真能拿到会话目录时再加回来。`manifest.permissions` 现在只剩 `renderer.extension` 与 `notify`，`contributes` 只剩 `commands`。
- 删除整层会话目录推断：「定位会话工作目录」那份数据层实现、业务层挑目录的纯函数与对应的回合结束事件监听全部移除，对应单测也删掉。
- 角落按钮跟随输入框插槽：只在对话界面出现，设置页、插件页、定时任务页不再显示；插槽重挂时用引用计数避免叠出两个按钮。
- 规格仍是 `specs/workspace-only/`（旧的 `specs/session-open/` 描述的是已被撤掉的交接）；`npm run check` 共 60 项，3 个测试文件。

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
