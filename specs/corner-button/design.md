# 角落按钮：技术设计

## 为什么换掉独立浮窗

查宿主实现（PI-Desktop 0.16.1）得到的事实：

1. `pi.ui.openPanel()` 的请求字段只有 `pluginId` / `title` / `shape` / `alwaysOnTop` / `resizable` / `width` / `height` / `htmlPath` / `netDomains` / `netAnyHost` / `allowMicrophone` / `development`——**没有 x / y**。宿主建 `BrowserWindow` 时不传坐标，Electron 默认居中。
2. 面板窗口能执行的动作只有 `getState` / `minimize` / `toggleMaximize` / `close` / `contextMenu`，**没有 setPosition / setBounds**。
3. 窗口位置不持久化：`~/.pi-desktop/window-state.json` 里只有主窗口的 `x` / `y` / `width` / `height`，没有插件面板。

结论：浮窗按钮的位置既不能设、也不能记，只能落在屏幕正中，因此换方案。

## 选定的做法：自绘层（角落浮层）

官方依据：

- `docs/plugin-plan/ui/self-dialog/`（**status: finalized**）：*「全屏弹窗与角落浮层由插件自理——无槽、无注册」*、*「插件在自己的组件里 `position: fixed` 自画」*。四条底线：画在自己组件里、卸载即消失、压不过宿主安全层、插件之间后开在上。
- SDK 类型注释（`packages/plugin-sdk/src/renderer.ts` 的 `PluginLayer`）：*"a host element above the app for a modal dialog or **a corner notice**, which the plugin fills through `createPortal` and draws with `position: fixed`"*；层在 z 600..899，宿主等用户决定（权限请求、提问、计划批准、扩展提示）时整层隐藏且 inert。
- 定位写法照官方 `apps/desktop/src/plugins/renderer-slots/slot-shell.css`：

  ```css
  .p-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  .p-overlay__corner { align-items: flex-end; justify-content: flex-end; background: transparent; pointer-events: none; padding: 16px; }
  .p-overlay__corner > * { pointer-events: auto; }
  ```

  即：**盒子铺满视口负责定位，盒子不吃点击，只有子元素吃**——这就是「不挡内容」的实现方式。

宿主那侧的实现（`renderer/assets/index-*.js` 里的层管理器）：

```js
const KH = 600, WH = 899;
open(pluginId) {
  const div = document.createElement("div");
  const z = Math.min(WH, Math.max(KH - 1, ...this.layers.values()) + 1);
  div.setAttribute("data-pi-plugin", pluginId);   // 样式作用域
  div.setAttribute("data-pi-layer", "");
  Object.assign(div.style, { position: "fixed", top: "0", left: "0", width: "0", height: "0", zIndex: String(z) });
  ...
}
```

层容器是**零尺寸** `fixed` 元素，所以子元素用 `position: fixed` 自己定位不会受它限制，也不会因为容器尺寸挡住任何东西。

## 改动

| 文件 | 改动 |
|---|---|
| `renderer/corner.mjs` | 新增。`createCornerButton(doc, { copy, invoke, timers })` 造 DOM 与状态机；`openCornerButton(pi, doc, { language, invoke })` 开层并把按钮画进去；`copyFor` / `labelFor` 是纯函数 |
| `renderer/styles.mjs` | 由 `BUTTON_CSS` 改为 `PLUGIN_CSS`，含输入框按钮与角落按钮两段；角落那段的盒子 `pointer-events: none`、子元素 `auto` |
| `renderer/index.mjs` | `onLoad` 注入样式、注册插槽、挂出角落按钮；`onUnload` 关层。两条入口共用 `invokeOpen()` |
| `main.js` | 去掉 `showWidget` / `onPanelInvoke` / 浮窗命令；`onLoad` 只注册 `/vscode` |
| `manifest.json` | 去掉 `ui` 与 `ui.panel`，命令只留 `vscode`，版本 0.5.0 |
| 删除 | `views/widget.html`、`views/widget.js`、`test/widget.test.js` |
| `test/renderer.test.mjs` | 新增角落按钮、自绘层、清单契约用例；DOM 用测试内的假实现 |

## 关键决定

- **角落按钮不再用 react**：层元素是真实 DOM，直接 `appendChild` 即可，省掉 `react-dom` 依赖；实现与测试都更简单。宿主给的层元素带 `data-pi-plugin`，`injectStyle` 的样式照样生效。
- **定时器可注入**：复位用 `timers.schedule` / `cancel`，默认走 `globalThis`；测试换成只记录不执行的实现，避免真等 1 秒多，也让「成功后短暂显示」这条能被断言。
- **文案表在模块里**：`corner.mjs` 自带 en / zh-CN 两表，按 `navigator.language` 选，满足 i18n 门禁「页面上不留写死的可见文案」。
- **状态机只有四个态**：`idle` / `busy` / `done` / `fail`，失败原因进 `title`，toast 由主进程统一发。
- **保留 `ui.panel` 之外的权限不变**：换方案后权限从 `renderer.extension + ui.panel + notify` 收窄回 `renderer.extension + notify`，收窄不触发宿主的权限复核，热重载即可生效。

- **右下角按钮带，而不是各画各的**：宿主没有角落槽位（0.16.1 的 `rendererSlots` 只有 `userAction` / `assistantAction` / `entryExtra` / `toolCard` / `blockRenderer` / `composerControl` / `composerTrigger`；`pi.ui.openLayer()` 给每个插件一个独立的 0×0 fixed 层，`injectStyle` 又把样式 `@scope` 到本插件自己的 `data-pi-plugin` 上）。两个插件各自 `inset:0` + `justify-content:flex-end`，必然落在同一个像素上——和 `pi-open-git-web` 的按钮真机重叠就是这么来的。解法是插件之间的约定：按钮带 `data-pi-corner-button` 标记，按 DOM 顺序从下往上排，靠后的按下面几颗的高度 `translateY` 让位。每颗按钮只给自己让位、不碰别家元素，两个插件各算一次结果一致；`translateY` 只改绘制，不影响别家量到的 `getBoundingClientRect().height`。**要根治还是得宿主给一个 corner 槽位**（已提 [vastsa/PI-Desktop#1469](https://github.com/vastsa/PI-Desktop/issues/1469)），约定只是在那之前的办法。

## 已知限制

- 角落按钮只在 PI-Desktop 窗口可见时能点（它在应用窗口内，不是桌面级窗口）；应用不在前台时用斜杠命令或系统级快捷键更合适。
- 宿主等用户做决定时（权限请求、提问、计划批准）整层隐藏且不可交互，按钮会临时消失，决定完自动回来。
- 层在 z 600..899，位于应用内容与宿主自己的对话框之上、宿主 tooltip 与窗口控件之下。
- 位置固定右下角，不做拖拽与记忆（宿主不提供）。

## 检查

`npm run check`：`node --check` 全部 js/mjs，再跑 3 个测试文件，共 40 项。渲染器测试不启动宿主。
