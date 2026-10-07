# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：立刻用 Visual Studio Code 打开当前工作目录。

仓库：https://github.com/w1ndys/pi-open-in-vscode

## 使用

三种入口，走同一条路径、结果提示也一样：

- **输入框右侧的按钮**：输入框工具条右边的「VSCode」，点一次就打开。
- **窗口右下角的角落按钮**：常驻的小胶囊，点一次就打开。
- **斜杠命令**：输入 `/vscode` 回车。后面不能带文字，否则宿主不会执行。
- **命令面板**：搜「用 VSCode 打开当前工作目录」。

打开顺序：macOS `open -a "Visual Studio Code"` → `code`。

## 行为

- 读 `pi.workspace.get().path`（主根）；没有工作目录就提示「当前没有工作目录，先打开一个项目。」，所有入口一致。
- 两个按钮都通过 `plugin.call` 调插件主进程的 `openWorkspace`，只传这一个方法名，不传参数。
- 拉起命令后立即返回，不等编辑器退出，不读文件、不写文件、不访问网络。

## 角落按钮怎么摆的

三个按钮的实现依据都在官方规格里，不是自己拼的：

- **角落按钮**走「自绘层」：`docs/plugin-plan/ui/self-dialog/`（status: finalized）写明「全屏弹窗与角落浮层由插件自理——无槽、无注册，插件在自己的元素里 `position: fixed` 自画」。定位照官方 `apps/desktop/src/plugins/renderer-slots/slot-shell.css` 的 `.p-overlay__corner`：铺满视口的 flex 盒子把按钮推到右下角，盒子本身 `pointer-events: none`、只有按钮 `auto`，所以它**不挡**下面的内容。层容器由宿主提供，是零尺寸的 fixed 元素。
- 想换到左下角：把 `renderer/styles.mjs` 里 `.pov-corner` 的 `justify-content: flex-end` 改成 `flex-start`。

## 为什么没有做独立浮窗按钮

试过 `ui.panel` + `ui.shape: "widget"` 的独立小窗。结论是**位置不可控**，所以放弃了：

- `pi.ui.openPanel()` 的参数里只有 `shape` / `alwaysOnTop` / `resizable` / `width` / `height`，**没有坐标**；宿主建窗时不传 `x` / `y`，Electron 就把它摆在屏幕正中，正好压住内容。
- 面板窗口能做的操作只有 `getState` / `minimize` / `toggleMaximize` / `close` / `contextMenu`，**没有移动位置**的通道。
- 窗口位置也不持久化（`window-state.json` 里只有主窗口），拖到哪里下次重启还是回正中。

## 本地开发版

这一版是本地开发加载用的：`manifest.json` 里有 `renderer` / `rendererActions` / `rendererCallMethods`，多声明了一个 `renderer.extension` 权限。

1. 打开 PI-Desktop 的 **Plugins** 页面，用 **Load development plugin** 指向本仓库目录。
2. 首次加载会要求复核权限——比上架版多了 `renderer.extension`（描述：*Draw UI in chat slots*，模块会跑在 PI-Desktop 自己的窗口里）。
3. 之后改这里的文件会自动热重载；**再加新权限需要回 Plugins 页面重新加载复核**（去掉权限不用）。

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

`node --check` 每个 js/mjs 文件，再跑 `node --test`（3 个测试文件：业务层、主进程入口、渲染器模块）。渲染器的测试用 `test/fixtures/react-stub.mjs` 顶替 react，靠 `test/fixtures/react-resolver.mjs` 这个解析钩子接上，DOM 用测试里的小假实现，不启动宿主。

## 权限

- `renderer.extension`：加载渲染器模块，画输入框按钮与角落按钮。模块只注册一个插槽组件、自绘一个角落按钮，只调 `openWorkspace`。
- `notify`：打开成功或失败后的 toast。

不声明 `ui.panel`（角落按钮用自绘层，不需要独立窗口），不声明 `clipboard.write`。

## 目录

```
main.js                  入口层：命令注册、按钮回调、编排
business/                业务层：打开计划（纯函数）
data/workspace.js        数据层：读主根路径
entity/open-result.js    实体层：结果形状
renderer/index.mjs       渲染器入口：输入框按钮 + 挂出角落按钮
renderer/corner.mjs      角落按钮：自绘层里的按钮与状态
renderer/styles.mjs      两个按钮的样式
test/                    单测与 react 桩
specs/                   需求与技术设计（按功能分目录）
```
