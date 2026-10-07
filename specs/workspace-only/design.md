# 只在有工作区的对话里出现：技术设计

## 宿主事实（PI-Desktop 0.16.1 打包代码 + 真机）

1. `pi.workspace.get()` **只返回「打开的项目根」**，与会话无关——应用里所有改当前工作区的地方都只跟选／设／清／删项目走。临时会话没有项目根，返回空。
2. 插件可达的 host API 里没有会话工作目录入口：`session.getScratchPath` 是应用内部 RPC；`session.get` / `session.list` 要 `session.read.own`，且按插件归属过滤。
3. `session:activated` 仍是 Planned events；插件能订阅的会话相关事件只有「回合结束」，而它切换会话不触发。
4. 渲染器的 `composerControl` 插槽 props 只有 `position`，拿不到会话 id。
5. Agent 扩展的 cwd 是 `projectPath ?? process.cwd()`（`agent-runtime/sidecar.js` 的 `createExtensionBridge`），临时会话落到 sidecar 进程目录（实测 `/`），所以扩展这条路当下也拿不到会话 scratch。

结论：**点击那一刻，插件与扩展都拿不到临时会话的目录**，任何推断都是猜。本版只保留能确定的那一半：有项目根就打开它，没有就什么都不做，也不显示入口。

## 改动

| 文件 | 改动 |
|---|---|
| `main.js` | 新增 `probeWorkspace()` 与 `PROBE_ACTION = "hasWorkspace"`；`onRendererCall` 先认探测、再认 `openWorkspace`，其余仍拒绝 |
| `business/pi-open-in-vscode.js` | `NO_PROJECT_ROOT_MESSAGE` 改成「本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。」——不再指向任何替代入口 |
| `renderer/index.mjs` | 删掉 `composer.readDraft` / `composer.insertText` 交接；新增挂载时探测与三种显示状态（unknown / yes / no），没有工作区就返回 `null`；`runOpen()` 把 `NO_PROJECT_ROOT` 转成 `NO_SESSION_DIR` 并收掉角落层 |
| `renderer/corner.mjs` | 删掉 `PHASE_HANDOFF` 与「已填入」文案；悬停提示改成「只在有工作区的对话里出现」 |
| `renderer/styles.mjs` | 只改注释：强调色那条从「交接提示」改成「没有工作区的说明」 |
| `manifest.json` | `rendererActions` 收回 `["plugin.call"]`，`rendererCallMethods` 变 `["hasWorkspace","openWorkspace"]`；description / changelog / safetyNotes / i18n 按新行为改写；版本仍 `0.6.0` |
| 删除 | `specs/session-open/`（它描述的交接已被撤掉），换成 `specs/workspace-only/` |

## 关键决定

- **探测与打开分成两个方法**：显示按钮前不能先真打开一次，所以给一个只读的 `hasWorkspace`；探测失败按「没有工作区」处理——少一个入口，好过打开一个猜出来的目录。
- **切会话不订阅事件，靠两处兜住**：挂载时探测一次（宿主换会话会重挂插槽），点击时发现没有工作区就把按钮撤掉。渲染器拿不到会话切换通知，这是能做到的最紧的兜底。
- **状态缓存只有一个作用**：`useState` 的初始值用上一次的结论，重挂时不会先空一下再画出来；本次探测结果永远覆盖它，插件卸载时清回 `unknown`。
- **没有工作区就不留入口**：不给「填一条命令」「指向别的命令」这类替代路径——两条路都验过，临时会话里都走不通，留着只会让用户白按一次。
- **扩展保留但只注册命令**：`/vscode-here` 仍在，`resolveDirectory()` 对空、`/`、`.` 一律取消（绝不打开系统根）。它当下在项目会话里与 `/vscode` 等效，等 #1459 修好之后才是临时会话那条路。

## 已知限制

- 临时会话里插件完全不可用——这是当前宿主能力下的正确行为，不是可以绕过的缺陷。
- 会话切走之后的那一次点击会先失败一次（按钮才撤掉），因为渲染器收不到「会话切了」的通知。

## 检查

`npm run check`：`node --check` 全部 js/mjs，再跑 4 个测试文件（业务层、主进程入口、渲染器模块、Agent 扩展），共 71 项。渲染器测试用 `test/fixtures/react-stub.mjs` 顶替 react、用测试内的小假 DOM，不启动宿主。
