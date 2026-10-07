/**
 * 渲染器模块单测：用桩 react 加载插件自己的渲染器入口，不启动宿主。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// 先装解析钩子，import 才会把 react 解析到桩上
register("./fixtures/react-resolver.mjs", import.meta.url);
const renderer = await import("../renderer/index.mjs");

/**
 * 假的宿主渲染器 API，记录插件调了它什么。
 * @param {boolean} [ok] dispatch 的回答是否成功
 */
function fakePi(ok) {
  const calls = { styles: [], slots: [], dispatches: [] };
  const pi = {
    plugin: { id: "io.github.w1ndys.pi-open-in-vscode", version: "0.4.0" },
    ui: {
      injectStyle: function (css) {
        calls.styles.push(css);
        return function () {};
      },
    },
    slots: {
      register: function (registration) {
        calls.slots.push(registration);
        return function () {};
      },
    },
    dispatch: function (action, payload) {
      calls.dispatches.push({ action: action, payload: payload });
      // 默认回答成功，失败分支由用例自己造
      if (ok === false) {
        return Promise.resolve({ ok: false, code: "NO_WORKSPACE", message: "当前没有工作目录，先打开一个项目。" });
      }
      return Promise.resolve({ ok: true, dir: "/tmp/demo" });
    },
  };
  return { calls: calls, pi: pi };
}

describe("renderer onLoad", function () {
  it("注册输入框右侧的插槽并注入样式", function () {
    const fake = fakePi();
    renderer.onLoad(fake.pi);
    assert.equal(fake.calls.slots.length, 1);
    assert.equal(fake.calls.slots[0].slot, "composerControl");
    assert.deepEqual(fake.calls.slots[0].positions, ["right"]);
    assert.equal(typeof fake.calls.slots[0].component, "function");
    assert.equal(fake.calls.styles.length, 1);
    renderer.onUnload();
  });
});

describe("按钮组件", function () {
  it("渲染出一个可点击的按钮", function () {
    const fake = fakePi();
    renderer.onLoad(fake.pi);
    const span = fake.calls.slots[0].component({ position: "right" });
    assert.equal(span.type, "span");
    const button = span.props.children[0];
    assert.equal(button.type, "button");
    assert.equal(button.props.disabled, false);
    assert.equal(button.props["aria-label"], "用 VSCode 打开当前工作目录");
    renderer.onUnload();
  });

  it("点击派发 plugin.call 调 openWorkspace", function () {
    const fake = fakePi();
    renderer.onLoad(fake.pi);
    const button = fake.calls.slots[0].component({}).props.children[0];
    button.props.onClick();
    assert.deepEqual(fake.calls.dispatches, [
      { action: "plugin.call", payload: { method: "openWorkspace", args: {} } },
    ]);
    renderer.onUnload();
  });
});

describe("结果文案", function () {
  it("成功时不显示文字", function () {
    assert.equal(renderer.messageFor({ ok: true, dir: "/tmp/demo" }), "");
  });

  it("失败时用插件给的说明", function () {
    const value = { ok: false, code: "NO_WORKSPACE", message: "当前没有工作目录，先打开一个项目。" };
    assert.equal(renderer.messageFor(value), "当前没有工作目录，先打开一个项目。");
  });

  it("没有说明时给通用文案", function () {
    assert.equal(renderer.messageFor({ ok: false }), "打开失败。");
    assert.equal(renderer.messageFor(null), "打开失败。");
  });

  it("宿主超时单独提示", function () {
    assert.equal(renderer.errorText({ code: "PLUGIN_CALL_TIMEOUT" }), "打开超时。");
  });

  it("其他拒绝用错误码兜底", function () {
    assert.equal(renderer.errorText({ code: "PLUGIN_ACTION_UNDECLARED" }), "打开失败。");
  });
});

describe("manifest 与代码一致", function () {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  it("声明了渲染器模块与 renderer.extension 权限", function () {
    assert.equal(manifest.renderer, "renderer/index.mjs");
    assert.equal(manifest.permissions.includes("renderer.extension"), true);
  });

  it("白名单覆盖按钮实际用的动作与方法", function () {
    assert.equal(manifest.rendererActions.includes("plugin.call"), true);
    assert.equal(manifest.rendererCallMethods.includes("openWorkspace"), true);
  });
});
