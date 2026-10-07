# 输入框按钮：技术设计

本轮增量只加一条入口，不改已有分层。

## 宿主契约（从 PI-Desktop 0.13.x 打包代码与上游仓库确证）

- 权限 `renderer.extension`：把插件的渲染器模块加载进 PI-Desktop 自己的窗口，用于画插槽组件。
- `manifest.renderer`：插件目录内的无构建 ES 模块；宿主用 `import()` 加载，`react` / `react-dom` / `react-dom/client` 由窗口的 import map 指向宿主实例。
- 模块导出 `onLoad(pi)` 与 `onUnload()`；`pi = { plugin, slots, ui, composer, dispatch }`。
- `pi.slots.register({ slot, positions, component })`：`slot` 取 `composerControl` 时，`positions` 只支持 `left` / `right`；`component` 是 React 函数组件（官方示例用 `createElement as h`，无 JSX）。
- `pi.dispatch(action, payload)`：`action` 必须声明在 `manifest.rendererActions`，并且要求真实用户手势（点击算）。
- `plugin.call` 带 `{ method, args }`，`method` 必须声明在 `manifest.rendererCallMethods`，落到插件主进程的 `onRendererCall(method, args)`。
- 单次调用宿主预算 2 秒（超时报 `PLUGIN_CALL_TIMEOUT`）、载荷上限 64 KiB、限速 10 QPS、连续 5 次失败冷却 30 秒。
- `pi.ui.injectStyle(css)`：样式限定在本插件自己的插槽挂载点内。

## 改动

| 文件 | 改动 |
|---|---|
| `renderer/index.mjs` | 新增。`onLoad` 注入样式并注册 `composerControl`（`positions: ["right"]`）；按钮点击派发 `plugin.call` → `openWorkspace`；失败时按钮旁显示一句原因 |
| `renderer/styles.mjs` | 新增。按钮样式，颜色用宿主设计变量，跟随明暗主题 |
| `main.js` | 新增 `onRendererCall`；`executeOpenPlan` / `openCurrentWorkspace` 增加可注入的执行器；导出常量供测试断言 |
| `manifest.json` | 加 `renderer`、`rendererActions`、`rendererCallMethods`，权限加 `renderer.extension`，版本升 `0.4.0`，补 description/changelog/safetyNotes/i18n |
| `test/renderer.test.mjs` | 新增。用桩 react 与解析钩子加载渲染器模块，验证插槽注册与派发载荷 |
| `test/renderer-call.test.js` | 新增。验证按钮回调的成功/失败/拒绝分支，以及命令仍按原 id 注册 |
| `test/fixtures/` | 新增。react 桩与解析钩子 |
| `package.json` | `check` 增加 `.mjs` 语法检查，并显式列出测试文件 |

## 关键决定

- **两条入口共用一条路径**：`onRendererCall` 与命令的 `run` 都调 `openCurrentWorkspace`，成功提示统一为 `SUCCESS_MESSAGE`，避免两套行为漂移。
- **执行器可注入**：`runCommand` 仍是默认真实实现，测试注入假执行器，这样单测不真开编辑器。这与既有源码风格一致（依赖直接注入，不加架构层）。
- **失败文案分源**：宿主拒绝（超时等）由 `errorText` 兜底；插件侧失败结果由 `messageFor` 取 `message`，与 toast 文案同源。
- **清单保留 `renderer` 字段**：插件中心发布会拒收这些字段，所以这一版只走本地开发加载；上架版本需要另出一份去掉 `renderer*` 的清单。

## 检查

`npm run check`：`node --check` 全部 js/mjs，再跑 3 个测试文件。渲染器测试不启动宿主。
