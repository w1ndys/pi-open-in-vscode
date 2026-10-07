# 只在有工作区的对话里出现：技术设计

## 宿主事实（PI-Desktop 0.16.1 打包代码 + 真机）

1. `pi.workspace.get()` **只返回「打开的项目根」**，与会话无关——应用里所有改当前工作区的地方都只跟选／设／清／删项目走。临时会话没有项目根，返回空。
2. 插件可达的 host API 里没有会话工作目录入口：`session.getScratchPath` 是应用内部 RPC；`session.get` / `session.list` 要 `session.read.own`，且按插件归属过滤。
3. `session:activated` 仍是 Planned events；插件能订阅的会话相关事件只有「回合结束」，而它切换会话不触发。
4. `composerControl` 插槽的 props 只有 `position`，拿不到会话 id；而且这个插槽**不能**当「在不在对话界面」的判据：应用外壳里 `ChatSurface` 是保留挂载的，切到设置页时它仍在树上（只是被设置页盖住），插槽的卸载回调不会触发。切到定时任务页 / 插件页才会卸载，但那时自绘层是挂在窗口上的，热重载留下的旧层已经没人能关。
5. Agent 扩展的 cwd 是 `projectPath ?? process.cwd()`（`agent-runtime/sidecar.js` 的 `createExtensionBridge`），临时会话落到 sidecar 进程目录（实测 `/`），所以扩展这条路当下也拿不到会话 scratch。

结论：**点击那一刻，插件与扩展都拿不到临时会话的目录**，任何推断都是猜。本版只保留能确定的那一半：有项目根就打开它，没有就什么都不做，也不显示入口。

## 改动

| 文件 | 改动 |
|---|---|
| `main.js` | 新增 `probeWorkspace()` 与 `PROBE_ACTION = "hasWorkspace"`；`onRendererCall` 先认探测、再认 `openWorkspace`，其余仍拒绝 |
| `business/pi-open-in-vscode.js` | `NO_PROJECT_ROOT_MESSAGE` 改成「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」——不再指向任何替代入口 |
| `renderer/index.mjs` | 去掉插槽注册与 react 依赖；改成盯 DOM：`MutationObserver` 把变动合并成一次检查，宿主渲染出输入框（`.composer-shell`）且中心点命中测试通过才画角落按钮，否则收掉；加载时先清掉残留的 `.pov-corner` 层；保留 `hasWorkspace` 探测与 `runOpen()`（把 `NO_PROJECT_ROOT` 转成 `NO_SESSION_DIR`，稍后收按钮） |
| `renderer/corner.mjs` | 悬停提示改成「用 VSCode 打开当前项目根；只在对话界面里出现。」 |
| `renderer/styles.mjs` | 只剩角落按钮的样式；输入框那一行按钮的 `.pov-btn` / `.pov-out` 一并删掉 |
| `manifest.json` | `rendererActions` 收回 `["plugin.call"]`，`rendererCallMethods` 变 `["hasWorkspace","openWorkspace"]`；去掉 `agent.extension` 权限与 `contributes.agentExtensions`；description / changelog / safetyNotes / i18n 按新行为改写；版本仍 `0.6.0` |
| 删除 | `specs/session-open/`（它描述的交接已被撤掉），换成 `specs/workspace-only/`；`extension.mjs` 与 `test/extension.test.mjs`（Agent 扩展整条路撤掉，见下） |

## 关键决定

- **探测与打开分成两个方法**：显示按钮前不能先真打开一次，所以给一个只读的 `hasWorkspace`；探测失败按「没有工作区」处理——少一个入口，好过打开一个猜出来的目录。
- **页面判断改盯 DOM，不再靠插槽**：插槽的挂载不代表「正在看对话」（设置页下对话框仍挂载），而自绘层又不随页面消失，所以判据换成「宿主渲染出输入框」＋「输入框真的露在外面」。命中测试（`elementFromPoint`）同时覆盖被整页界面盖住、被挤出视口、被压成零宽三种情况；`.app-shell.settings-mode` 是给设置页留的第二道保险。
- **切会话不订阅事件，靠两处兜住**：输入框换了就立刻重新探测（换会话通常重挂输入框），没换时最多每 1.5 秒重新问一次；点击时发现没有工作区就把按钮收掉（先留原因，稍后收起）。
- **探测与打开分成两个方法**：显示按钮前不能先真打开一次，所以给一个只读的 `hasWorkspace`；探测失败按「没有工作区」处理——少一个入口，好过打开一个猜出来的目录。
- **加载时清残留层**：热重载会重新加载模块，上一轮实例开出来的层没人能关，留着就会出现在所有页面上；`onLoad` 先把 `.pov-corner` 元素摘掉，再按当前页面决定要不要画。
- **扩展整条路撤掉**：`agent.extension` 是一个能在 Agent sidecar 内执行命令的重权限，而扩展只在有工作区的对话里能干活（与 `/vscode` 完全等效），临时会话里拿到的是系统根、必须取消。付出与收益不成比例，所以删掉 `extension.mjs`，不声明该权限。等 #1459 修好、扩展真能拿到会话目录时再加回来（那时它才是临时会话唯一的路）。源码在 git 历史里，恢复不需要重写。

## 已知限制

- 临时会话里插件完全不可用——这是当前宿主能力下的正确行为，不是可以绕过的缺陷。
- 会话切走之后的那一次点击会先失败一次（按钮才收掉），因为渲染器收不到「会话切了」的通知；但换输入框、切页面都会重新探测，最多 1.5 秒按钮就回到正确状态。
- 判断页面用的是宿主自己的类名（`.composer-shell`、`.app-shell.settings-mode`）。宿主改样式表就得跟着改，这是这一版唯一的脆弱点；没有更稳的信号可用（见上文的宿主事实）。独立浮窗那条路（`ui.panel` + `ui.shape: widget`）位置不可控，已弃用，不要拿它来绕开这条。

## 检查

`npm run check`：`node --check` 全部 js/mjs，再跑 3 个测试文件（业务层、主进程入口、渲染器模块），共 54 项。渲染器测试用测试内的假 DOM 与假 `MutationObserver`，不启动宿主；页面判断的各条分支（没有输入框、设置页盖住、输入框没尺寸、命中点是输入框里面的元素、从别的页面切回来、点一次失败后收按钮）与「不再注册插槽、不引用 react」「不再声明 agent.extension」都在这一份里断言。
