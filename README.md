# 用 VSCode 打开

PI-Desktop 插件（`io.github.w1ndys.pi-open-in-vscode`）：立刻用 Visual Studio Code 打开当前工作目录。

仓库：https://github.com/w1ndys/pi-open-in-vscode

## 使用

任选一种，两条入口走同一条路径、结果提示也一样：

- **按钮**：输入框工具条右侧的「VSCode」按钮，点一次就打开。
- **斜杠命令**：输入 `/vscode` 回车。后面不能带文字，否则宿主不会执行。
- **命令面板**：搜「用 VSCode 打开当前工作目录」。

打开顺序：macOS `open -a "Visual Studio Code"` → `code`。

## 行为

- 读 `pi.workspace.get().path`（主根）；没有工作目录就提示「当前没有工作目录，先打开一个项目。」，两条入口一致。
- 按钮通过 `plugin.call` 调插件主进程的 `openWorkspace`，只传这一个方法名，不传参数。
- 拉起命令后立即返回，不等编辑器退出，不读文件、不写文件、不访问网络。

## 本地开发版（当前分支）

这一版是本地开发加载用的：`manifest.json` 里有 `renderer` / `rendererActions` / `rendererCallMethods`，并多声明了一个 `renderer.extension` 权限。

1. 打开 PI-Desktop 的 **Plugins** 页面，用 **Load development plugin** 指向本仓库目录。
2. 首次加载会要求复核权限——比上架版多了 `renderer.extension`（描述：*Draw UI in chat slots*，模块会跑在 PI-Desktop 自己的窗口里）。
3. 之后改这里的文件会自动热重载；**再加新权限需要回 Plugins 页面重新加载复核**。

**为什么不上架这一版**：插件中心的发布接口（`create_plugin` / `pack_plugin` / `submit_version`）没有 `renderer` 这类字段，服务端会直接拒收（`json: unknown field "renderer"`），平台又是按字段重建 `manifest.json` 的——发上去会丢掉按钮。所以市场版本仍然只能是纯命令版。

## 检查

```bash
npm run check
```

`node --check` 每个 js/mjs 文件，再跑 `node --test`（3 个测试文件：业务层、主进程入口、渲染器模块）。渲染器模块的测试用 `test/fixtures/react-stub.mjs` 顶替 react，靠 `test/fixtures/react-resolver.mjs` 这个解析钩子接上，不启动宿主、不真开浏览器。

## 权限

- `renderer.extension`：加载渲染器模块，在输入框那行画按钮。模块只注册一个插槽组件，只调 `openWorkspace`。
- `notify`：打开成功或失败后的 toast。

不声明 `clipboard.write`，不读写剪贴板。

## 目录

```
main.js                  入口层：命令注册、按钮回调、编排
business/                业务层：打开计划（纯函数）
data/workspace.js        数据层：读主根路径
entity/open-result.js    实体层：结果形状
renderer/index.mjs       渲染器入口：注册输入框按钮
renderer/styles.mjs      按钮样式（随主题走宿主变量）
test/                    单测与 react 桩
specs/composer-button/   本轮增量的需求与技术设计
```
