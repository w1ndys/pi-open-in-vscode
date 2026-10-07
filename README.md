# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：立刻用 Visual Studio Code 打开本次对话的工作目录。

仓库：https://github.com/w1ndys/pi-open-in-vscode

## 使用

只在**有工作区**的对话里出现（也就是打开了项目的会话）：

- **输入框右侧的按钮**：输入框工具条右边的「VSCode」，点一次就打开。
- **窗口右下角的角落按钮**：常驻的小胶囊，点一次就打开。
- **斜杠命令**：输入 `/vscode` 回车。后面不能带文字，否则宿主不会执行。
- **命令面板**：搜「用 VSCode 打开当前工作目录」。

打开顺序：macOS `open -a "Visual Studio Code"` → `code`。

**临时会话（没有项目根）里插件什么都不显示**：不画按钮、不挂角落按钮，也没有替代命令。原因见下一节。

## 打开哪个目录：只读项目根，不猜

- **有工作区**（`pi.workspace.get()` 给出项目根）：按钮与 `/vscode` 直接打开它。
- **没有工作区**（临时会话）：插件不显示任何入口，也不去拼路径；`/vscode` 命令只说一句「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」，一次外部命令都不拉起来。

为什么不做目录推断：插件在点击那一刻**拿不到当前会话**——`pi.workspace.get()` 只返回打开的项目根，插件可达的 host API 里没有会话工作目录入口，`session:activated` 事件仍是 Planned；插件能订阅的会话相关事件只有「回合结束」，而它切换会话不触发，据此记下的会话 id 会过期。

Agent 扩展这条路也验过，同样拿不到：扩展的 cwd 是 `projectPath ?? process.cwd()`，临时会话没有项目根，于是落到 sidecar 进程目录（本机是 `/`）。当时试过在临时会话里把 `/vscode-here` 填进输入框交给扩展，真机上打开的是系统根目录，所以这条交接已经撤掉。已向官方提了反馈：[vastsa/PI-Desktop#1459](https://github.com/vastsa/PI-Desktop/issues/1459)（扩展 cwd 不吃会话 scratch）、[vastsa/PI-Desktop#993](https://github.com/vastsa/PI-Desktop/issues/993)（插件拿不到当前焦点会话）。

细节与验收见 `specs/workspace-only/`。

## 行为

- 插槽挂载时先派发一次 `plugin.call` 探测（`method: "hasWorkspace"`）：只有插件明确说有工作区，才画按钮、才开角落按钮那一层。探测只读一次项目根，不打开任何东西。
- 两个按钮都通过 `plugin.call` 调 `openWorkspace`，只传这一个方法名，不传参数；除这两条调用外不派发别的动作（`manifest.rendererActions` 只有 `plugin.call`）。
- 拉起命令后立即返回，不等编辑器退出，不读文件内容、不写文件、不访问网络、不枚举目录。
- 角落按钮跟在输入框插槽上，所以**只在对话界面出现**；设置页、插件页、定时任务页都没有它。
- 会话切走之后按钮不会自己消失（渲染器收不到切换通知）：这种时候点一次会失败，按钮随即撤掉，并留一句说明。
- `/vscode-here` 仍由扩展注册，只跑一条写死的命令；目录为空、为 `/` 或为 `.` 时直接取消，绝不打开系统根。它当下与 `/vscode` 等效，等 #1459 修好之后才是临时会话那条路。

## 角落按钮怎么摆的

按钮的实现依据在官方规格里，不是自己拼的：

- **角落按钮**走「自绘层」：`docs/plugin-plan/ui/self-dialog/`（status: finalized）写明「全屏弹窗与角落浮层由插件自理——无槽、无注册，插件在自己的元素里 `position: fixed` 自画」。定位照官方 `apps/desktop/src/plugins/renderer-slots/slot-shell.css` 的 `.p-overlay__corner`：铺满视口的 flex 盒子把按钮推到右下角，盒子本身 `pointer-events: none`、只有按钮 `auto`，所以它**不挡**下面的内容。层容器由宿主提供，是零尺寸的 fixed 元素。
- 想换到左下角：把 `renderer/styles.mjs` 里 `.pov-corner` 的 `justify-content: flex-end` 改成 `flex-start`。

## 为什么没有做独立浮窗按钮

试过 `ui.panel` + `ui.shape: "widget"` 的独立小窗。结论是**位置不可控**，所以放弃了：

- `pi.ui.openPanel()` 的参数里只有 `shape` / `alwaysOnTop` / `resizable` / `width` / `height`，**没有坐标**；宿主建窗时不传 `x` / `y`，Electron 就把它摆在屏幕正中，正好压住内容。
- 面板窗口能做的操作只有 `getState` / `minimize` / `toggleMaximize` / `close` / `contextMenu`，**没有移动位置**的通道。
- 窗口位置也不持久化（`window-state.json` 里只有主窗口），拖到哪里下次重启还是回正中。

## 本地开发版

这一版是本地开发加载用的：`manifest.json` 里有 `renderer` / `rendererActions` / `rendererCallMethods`，多了 `renderer.extension` 与 `agent.extension` 两个权限。

1. 打开 PI-Desktop 的 **Plugins** 页面，用 **Load development plugin** 指向本仓库目录。
2. 首次加载会要求复核权限——比上架版多了 `renderer.extension`（描述：*Draw UI in chat slots*，模块会跑在 PI-Desktop 自己的窗口里）与 `agent.extension`（扩展在 Agent sidecar 内运行）。
3. 之后改这里的文件会自动热重载；**再加新权限需要回 Plugins 页面重新加载复核**（去掉权限不用）。扩展模块按插件 id 缓存在 sidecar 里，改 `extension.mjs` 要退出应用重开才生效。

**这一版为什么上不了架**：插件中心的发布接口（`create_plugin` / `pack_plugin` / `submit_version`）不认 `renderer` 这三个字段，会直接拒收（`json: unknown field "renderer"`）；平台又是按字段重建 `manifest.json` 的，把 `manifest.json` 塞进 `files` 也会被重建掉——按钮留不住。已据此向官方提了反馈（[vastsa/PI-Desktop#1454](https://github.com/vastsa/PI-Desktop/issues/1454)）。

发布渠道对照（都是我实测过的干跑结果）：

| 版本形态 | 能否发到插件中心 |
|---|---|
| 纯命令版（就是中心的 `v0.3.0`） | ✅ 能 |
| 声明 `ui` 的面板 / 浮窗版 | ✅ 能（`readyToPublish: true`；客户端的市场元数据类型本身就带 `ui`） |
| 本版（`renderer` + 两个按钮） | ❌ 不能，字段被发布接口拒收 |

所以按钮版目前只有两条分发路径：**Load development plugin** 指向本仓库，或把自己的 `.piplug` 从 GitHub Release 发出去、对方用 **Install plugin package** 安装（宿主打包器原样保留 `manifest.json`，`renderer` 字段留得住）。

## 检查

```bash
npm run check
```

`node --check` 每个 js/mjs 文件，再跑 `node --test`（4 个测试文件：业务层、主进程入口、渲染器模块、Agent 扩展，共 71 项）。渲染器的测试用 `test/fixtures/react-stub.mjs` 顶替 react，靠 `test/fixtures/react-resolver.mjs` 这个解析钩子接上，DOM 用测试里的小假实现，不启动宿主。

## 权限

- `renderer.extension`：加载渲染器模块，画输入框按钮与角落按钮。模块只注册一个插槽组件、自绘一个角落按钮，只调 `openWorkspace` 与 `hasWorkspace` 两个方法（`manifest.rendererActions` 只有 `plugin.call`）。
- `agent.extension`：加载 Agent 扩展，注册 `/vscode-here`；扩展只跑一条写死的打开命令，目录不可信时直接取消。
- `notify`：打开成功或失败后的 toast。

不声明 `ui.panel`（角落按钮用自绘层，不需要独立窗口），不声明 `clipboard.write`，也不声明任何文件或网络权限。

## 目录

```
main.js                  入口层：命令注册、按钮回调、工作区探测与编排
business/                业务层：打开计划（纯函数）
data/workspace.js        数据层：读主根路径
entity/open-result.js    实体层：结果形状
extension.mjs            Agent 扩展：注册 /vscode-here，只在目录可信时打开
renderer/index.mjs       渲染器入口：探测工作区 + 输入框按钮 + 挂出角落按钮
renderer/corner.mjs      角落按钮：自绘层里的按钮与状态
renderer/styles.mjs      两个按钮与结果提示的样式
test/                    单测与 react 桩
specs/                   需求与技术设计（按功能分目录）
```
