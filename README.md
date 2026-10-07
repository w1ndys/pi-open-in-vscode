# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：立刻用 Visual Studio Code 打开当前项目根。

仓库：https://github.com/w1ndys/pi-open-in-vscode

## 使用

- **右下角的角落按钮**：对话界面里常驻的小胶囊，点一次就打开。
- **斜杠命令**：输入 `/vscode` 回车。后面不能带文字，否则宿主不会执行。
- **命令面板**：搜「用 VSCode 打开当前工作目录」。

打开顺序：macOS `open -a "Visual Studio Code"` → `code`。

按钮**只在对话界面里出现**：切到设置页、定时任务页、插件页会自动收起，回到对话界面又回来。没有项目根（临时会话）时也不显示。

## 按钮什么时候显示

自绘层挂在窗口上，**不随页面切换消失**，所以显示与否由插件自己盯页面判断。模块在加载时开一个 `MutationObserver`，把 DOM 变动合并成一次检查，三个条件同时满足才画按钮：

1. 宿主渲染出了输入框（`.composer-shell`）——说明现在真的是对话界面；
2. 输入框确实露在屏幕上（中心点做一次命中测试：没被设置页之类的整页界面盖住、没被挤出视口、有尺寸）；
3. 这次对话有工作区（插件主进程读一次 `pi.workspace.get()`，拿不到就不画）。

任一条件不成立就立刻把按钮收掉。会话切走、按钮还在时点一次，会先把「没有工作区」的原因留在按钮上，稍后再把按钮收掉。按钮没显示期间最多每 1.5 秒重新问一次工作区，所以切回有工作区的会话时按钮能自己回来。

## 打开哪个目录：只读项目根，不猜

- **有工作区**（`pi.workspace.get()` 给出项目根）：按钮与 `/vscode` 直接打开它。
- **没有工作区**（临时会话）：插件不显示按钮，也不去拼路径；`/vscode` 命令只说一句「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」，一次外部命令都不拉起来。

为什么不做目录推断：插件在点击那一刻**拿不到当前会话**——`pi.workspace.get()` 只返回打开的项目根，插件可达的 host API 里没有会话工作目录入口，`session:activated` 事件仍是 Planned；插件能订阅的会话相关事件只有「回合结束」，而它切换会话不触发，据此记下的会话 id 会过期。

Agent 扩展这条路也验过，同样拿不到：扩展的 cwd 是 `projectPath ?? process.cwd()`，临时会话没有项目根，于是落到 sidecar 进程目录（本机是 `/`）。当时试过在临时会话里把 `/vscode-here` 填进输入框交给扩展，真机上打开的是系统根目录，所以交接与扩展都已撤掉。已向官方提了反馈：[vastsa/PI-Desktop#1459](https://github.com/vastsa/PI-Desktop/issues/1459)（扩展 cwd 不吃会话 scratch）、[vastsa/PI-Desktop#993](https://github.com/vastsa/PI-Desktop/issues/993)（插件拿不到当前焦点会话）。

细节与验收见 `specs/workspace-only/`。

## 行为

- 插槽挂载时先派发一次 `plugin.call` 探测（`method: "hasWorkspace"`）：只有插件明确说有工作区，才画按钮。探测只读一次项目根，不打开任何东西。
- 按钮通过 `plugin.call` 调 `openWorkspace`，不传参数；除这两条调用外不派发别的动作（`manifest.rendererActions` 只有 `plugin.call`）。
- 拉起命令后立即返回，不等编辑器退出，不读文件内容、不写文件、不访问网络、不枚举目录。
- 插件不注册任何插槽、不依赖 react：模块只注入样式、自绘一个角落按钮、盯 DOM。也不用 `composer.*` 动作。
- 插件不注册 Agent 扩展、不声明 `agent.extension`：扩展只能在项目会话里打开项目根（与 `/vscode` 等效），在临时会话里拿到的是系统根、必须取消，却要一个能在 Agent sidecar 内执行命令的重权限。等 #1459 落地、扩展真能拿到会话目录时再加回来。

## 角落按钮怎么摆的

按钮的实现依据在官方规格里，不是自己拼的：

- **角落按钮**走「自绘层」：`docs/plugin-plan/ui/self-dialog/`（status: finalized）写明「全屏弹窗与角落浮层由插件自理——无槽、无注册，插件在自己的元素里 `position: fixed` 自画」。定位照官方 `apps/desktop/src/plugins/renderer-slots/slot-shell.css` 的 `.p-overlay__corner`：铺满视口的 flex 盒子把按钮推到右下角，盒子本身 `pointer-events: none`、只有按钮 `auto`，所以它**不挡**下面的内容。层容器由宿主提供，是零尺寸的 fixed 元素。
- 想换到左下角：把 `renderer/styles.mjs` 里 `.pov-corner` 的 `justify-content: flex-end` 改成 `flex-start`。

## 为什么显示逻辑要盯 DOM

先前的做法是把按钮的显示挂在 `composerControl` 插槽上（插件组件挂载就开层、卸载就收层），指望插槽只在对话界面存在。查 PI-Desktop 0.16.1 的宿主代码后发现两条都靠不住：

- 应用外壳里对话框是被**保留挂载**的：切到设置页时 `ChatSurface` 仍在树上（只是被设置页盖住），插槽的卸载回调根本不触发，层就一直挂在窗口上——表现为按钮出现在所有页面。
- 切到定时任务页、插件页时 `ChatSurface` 确实卸载，但热重载留下的旧层已经没人能关，同样会一直显示。

所以现在改成盯 DOM，并在加载时先清掉残留的层。宿主里判断用的类名（`.composer-shell`、`.app-shell.settings-mode`）是宿主自己的样式表里的，跟着宿主升级可能变，这是这一版已知的脆弱点。

## 为什么没有做独立浮窗按钮

试过 `ui.panel` + `ui.shape: "widget"` 的独立小窗。结论是**位置不可控**，所以放弃了：

- `pi.ui.openPanel()` 的参数里只有 `shape` / `alwaysOnTop` / `resizable` / `width` / `height`，**没有坐标**；宿主建窗时不传 `x` / `y`，Electron 就把它摆在屏幕正中，正好压住内容。
- 面板窗口能做的操作只有 `getState` / `minimize` / `toggleMaximize` / `close` / `contextMenu`，**没有移动位置**的通道。
- 窗口位置也不持久化（`window-state.json` 里只有主窗口），拖到哪里下次重启还是回正中。

## 本地开发版

这一版是本地开发加载用的：`manifest.json` 里有 `renderer` / `rendererActions` / `rendererCallMethods`，比上架版多了 `renderer.extension` 权限。

1. 打开 PI-Desktop 的 **Plugins** 页面，用 **Load development plugin** 指向本仓库目录。
2. 首次加载会要求复核权限——就是 `renderer.extension`（描述：*Draw UI in chat slots*，模块会跑在 PI-Desktop 自己的窗口里）。
3. 之后改这里的文件会自动热重载；再加新权限时也要回 Plugins 页面重新加载复核（去掉权限不用）。

**这一版为什么上不了架**：插件中心的发布接口（`create_plugin` / `pack_plugin` / `submit_version`）不认 `renderer` 这三个字段，会直接拒收（`json: unknown field "renderer"`）；平台又是按字段重建 `manifest.json` 的，把 `manifest.json` 塞进 `files` 也会被重建掉——按钮留不住。已据此向官方提了反馈（[vastsa/PI-Desktop#1454](https://github.com/vastsa/PI-Desktop/issues/1454)）。

发布渠道对照（都是我实测过的干跑结果）：

| 版本形态 | 能否发到插件中心 |
|---|---|
| 纯命令版（就是中心的 `v0.3.0`） | ✅ 能 |
| 声明 `ui` 的面板 / 浮窗版 | ✅ 能（`readyToPublish: true`；客户端的市场元数据类型本身就带 `ui`） |
| 本版（`renderer` + 角落按钮） | ❌ 不能，字段被发布接口拒收 |

所以按钮版目前只有两条分发路径：**Load development plugin** 指向本仓库，或把自己的 `.piplug` 从 GitHub Release 发出去、对方用 **Install plugin package** 安装（宿主打包器原样保留 `manifest.json`，`renderer` 字段留得住）。

## 检查

```bash
npm run check
```

`node --check` 每个 js/mjs 文件，再跑 `node --test`（3 个测试文件：业务层、主进程入口、渲染器模块，共 54 项）。渲染器的测试用测试内的假 DOM 与假 `MutationObserver`，不启动宿主；页面判断各条分支（没有输入框、设置页盖住、输入框没尺寸、命中点在里面、切回对话界面、点一次失败后收按钮）都在那一份里断言。

## 权限

- `renderer.extension`：加载渲染器模块。模块不注册插槽、不依赖 react，只注入样式、自绘一个角落按钮、盯 DOM 判断该不该显示；只调 `hasWorkspace`（探测）与 `openWorkspace`（打开）两个方法，除这两条 `plugin.call` 外不派发别的动作。
- `notify`：打开成功或失败后的 toast。

不声明 `ui.panel`（角落按钮用自绘层，不需要独立窗口），不声明 `agent.extension`，不声明 `clipboard.write`，也不声明任何文件或网络权限。

## 目录

```
main.js                  入口层：命令注册、按钮回调、工作区探测与编排
business/                业务层：打开计划（纯函数）
data/workspace.js        数据层：读主根路径
entity/open-result.js    实体层：结果形状
renderer/index.mjs       渲染器入口：盯 DOM 判断页面 + 开收角落按钮 + 探测工作区
renderer/corner.mjs      角落按钮：自绘层里的按钮与状态
renderer/styles.mjs      角落按钮的样式
test/                    单测
specs/                   需求与技术设计（按功能分目录）
```
