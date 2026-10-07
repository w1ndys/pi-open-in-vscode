/**
 * 渲染器模块单测：用桩 react 加载插件自己的渲染器入口，不启动宿主。
 * 角落按钮走自绘层，DOM 由这里的假实现顶替。
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { copyFor, labelFor, createCornerButton, openCornerButton } from "../renderer/corner.mjs";

// 先装解析钩子，import 才会把 react 解析到桩上
register("./fixtures/react-resolver.mjs", import.meta.url);
const renderer = await import("../renderer/index.mjs");

/**
 * 假 DOM：只实现控件用到的几个方法，点击可以直接触发。
 */
function fakeDocument() {
  function makeElement(tagName) {
    const listeners = {};
    return {
      tagName: tagName,
      className: "",
      textContent: "",
      title: "",
      disabled: false,
      children: [],
      attributes: {},
      appendChild: function (child) {
        this.children.push(child);
        return child;
      },
      setAttribute: function (name, value) {
        this.attributes[name] = String(value);
      },
      removeAttribute: function (name) {
        delete this.attributes[name];
      },
      addEventListener: function (type, handler) {
        listeners[type] = handler;
      },
      click: function () {
        // 只有注册过才调，模拟一次真实点击
        if (listeners.click) {
          listeners.click();
        }
      },
    };
  }
  return { createElement: makeElement };
}

/**
 * 只记录不执行的定时器，测试可以自己决定什么时候复位。
 */
function recordingTimers() {
  const record = { scheduled: [], cancelled: [] };
  return {
    record: record,
    schedule: function (task, delayMs) {
      const handle = { task: task, delayMs: delayMs };
      record.scheduled.push(handle);
      return handle;
    },
    cancel: function (handle) {
      record.cancelled.push(handle);
    },
  };
}

/**
 * 一个可以自己决定何时结算的 Promise。
 */
function deferred() {
  const box = {};
  box.promise = new Promise(function (resolve, reject) {
    box.resolve = resolve;
    box.reject = reject;
  });
  return box;
}

/**
 * 假的宿主渲染器 API，记录插件调了它什么。
 * @param {object} [options] { openResult, language }
 */
function fakePi(options) {
  const settings = options || {};
  const calls = { styles: [], slots: [], dispatches: [], layersOpened: 0, layersClosed: 0 };
  const layerElement = fakeDocument().createElement("div");
  const pi = {
    plugin: { id: "io.github.w1ndys.pi-open-in-vscode", version: "0.5.0" },
    ui: {
      injectStyle: function (css) {
        calls.styles.push(css);
        return function () {};
      },
      openLayer: function () {
        calls.layersOpened += 1;
        return {
          element: layerElement,
          close: function () {
            calls.layersClosed += 1;
          },
        };
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
      // 默认回答成功；失败分支由用例自己造
      if (settings.openResult === "fail") {
        return Promise.resolve({ ok: false, code: "NO_WORKSPACE", message: "当前没有工作目录，先打开一个项目。" });
      }
      if (settings.openResult === "reject") {
        return Promise.reject({ code: "PLUGIN_CALL_TIMEOUT", message: "打开超时。" });
      }
      return Promise.resolve({ ok: true, dir: "/tmp/demo" });
    },
  };
  return { calls: calls, pi: pi, layerElement: layerElement };
}

afterEach(function () {
  // 用完就摘掉，别影响别的测试文件
  delete globalThis.document;
});

describe("文案", function () {
  it("按语言标签选表，zh 系列都归简体", function () {
    assert.equal(copyFor("zh-CN").idle, "VSCode");
    assert.equal(copyFor("zh-CN").done, "已打开");
    assert.equal(copyFor("zh-TW").done, "已打开");
    assert.equal(copyFor("en-US").done, "Opened");
    assert.equal(copyFor(undefined).done, "Opened");
  });

  it("四个状态各有自己的字", function () {
    const copy = copyFor("zh-CN");
    assert.equal(labelFor(copy, "idle"), "VSCode");
    assert.equal(labelFor(copy, "busy"), "打开中");
    assert.equal(labelFor(copy, "done"), "已打开");
    assert.equal(labelFor(copy, "fail"), "失败");
  });
});

describe("角落按钮元素", function () {
  it("盒子铺满视口但只有按钮可点", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, { copy: copyFor("zh-CN"), invoke: function () {} });
    assert.equal(ui.element.className, "pov-corner");
    assert.equal(ui.element.children.length, 1);
    assert.equal(ui.button.className, "pov-corner-btn");
    assert.equal(ui.button.type, "button");
  });

  it("初始是空闲并带悬停提示", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, { copy: copyFor("zh-CN"), invoke: function () {} });
    assert.equal(ui.phase(), "idle");
    assert.equal(ui.button.textContent, "VSCode");
    assert.equal(ui.button.title, "用 VSCode 打开当前工作目录。");
    assert.equal(ui.button.disabled, false);
  });

  it("打开中禁用按钮，重复点击不重复发请求", function () {
    const doc = fakeDocument();
    const pending = deferred();
    let called = 0;
    const ui = createCornerButton(doc, {
      copy: copyFor("zh-CN"),
      invoke: function () {
        called += 1;
        return pending.promise;
      },
    });
    ui.click();
    assert.equal(called, 1);
    assert.equal(ui.phase(), "busy");
    assert.equal(ui.button.textContent, "打开中");
    assert.equal(ui.button.disabled, true);
    ui.click();
    assert.equal(called, 1);
  });

  it("成功后显示已打开并安排复位", function () {
    const doc = fakeDocument();
    const timers = recordingTimers();
    const ui = createCornerButton(doc, {
      copy: copyFor("zh-CN"),
      invoke: function () {
        return Promise.resolve({ ok: true });
      },
      timers: timers,
    });
    ui.click();
    return Promise.resolve().then(function () {
      assert.equal(ui.phase(), "done");
      assert.equal(ui.button.textContent, "已打开");
      assert.equal(ui.button.disabled, false);
      assert.equal(timers.record.scheduled.length, 1);
      // 复位后回到空闲
      timers.record.scheduled[0].task();
      assert.equal(ui.phase(), "idle");
      assert.equal(ui.button.textContent, "VSCode");
    });
  });

  it("插件侧说没打开时把原因写进悬停提示", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, {
      copy: copyFor("zh-CN"),
      invoke: function () {
        return Promise.resolve({ ok: false, message: "当前没有工作目录，先打开一个项目。" });
      },
      timers: recordingTimers(),
    });
    ui.click();
    return Promise.resolve().then(function () {
      assert.equal(ui.phase(), "fail");
      assert.equal(ui.button.textContent, "失败");
      assert.equal(ui.button.title, "当前没有工作目录，先打开一个项目。");
    });
  });

  it("宿主拒绝时也给失败提示", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, {
      copy: copyFor("en"),
      invoke: function () {
        return Promise.reject({ code: "PLUGIN_CALL_TIMEOUT", message: "timed out" });
      },
      timers: recordingTimers(),
    });
    ui.click();
    return Promise.resolve().then(function () {
      assert.equal(ui.phase(), "fail");
      assert.equal(ui.button.title, "timed out");
    });
  });
});

describe("自绘层", function () {
  it("开层并把按钮画进去", function () {
    const fake = fakePi();
    const doc = fakeDocument();
    const corner = openCornerButton(fake.pi, doc, {
      language: "zh-CN",
      invoke: function () {},
    });
    assert.equal(fake.calls.layersOpened, 1);
    assert.equal(fake.layerElement.children.length, 1);
    assert.equal(corner.button.element.className, "pov-corner");
    corner.close();
    assert.equal(fake.calls.layersClosed, 1);
  });
});

describe("渲染器 onLoad", function () {
  it("注入样式、注册输入框按钮、挂出角落按钮", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    assert.equal(fake.calls.styles.length, 1);
    assert.equal(fake.calls.slots.length, 1);
    assert.equal(fake.calls.slots[0].slot, "composerControl");
    assert.deepEqual(fake.calls.slots[0].positions, ["right"]);
    assert.equal(fake.calls.layersOpened, 1);
    assert.equal(fake.layerElement.children.length, 1);
    renderer.onUnload();
  });

  it("卸载时关掉自绘层", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    renderer.onUnload();
    assert.equal(fake.calls.layersClosed, 1);
  });
});

describe("按钮组件", function () {
  it("渲染出一个可点击的按钮", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
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
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    const button = fake.calls.slots[0].component({}).props.children[0];
    button.props.onClick();
    assert.deepEqual(fake.calls.dispatches, [
      { action: "plugin.call", payload: { method: "openWorkspace", args: {} } },
    ]);
    renderer.onUnload();
  });

  it("两条入口派发的是同一个调用", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    const button = fake.calls.slots[0].component({}).props.children[0];
    button.props.onClick();
    // 角落按钮走同一条路径
    const cornerButton = fake.layerElement.children[0].children[0];
    cornerButton.click();
    assert.equal(fake.calls.dispatches.length, 2);
    assert.deepEqual(fake.calls.dispatches[0], fake.calls.dispatches[1]);
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

  it("白名单覆盖两个按钮实际用的动作与方法", function () {
    assert.equal(manifest.rendererActions.includes("plugin.call"), true);
    assert.equal(manifest.rendererCallMethods.includes("openWorkspace"), true);
  });

  it("不再声明独立窗口那一套", function () {
    // 浮窗按钮因位置不可控已去掉，这里禁止它悄悄回来
    assert.equal(manifest.ui, undefined);
    assert.equal(manifest.permissions.includes("ui.panel"), false);
  });

  it("开机自启并覆盖命令", function () {
    assert.equal(manifest.activationEvents.includes("onStartup"), true);
    for (const command of manifest.contributes.commands) {
      assert.equal(manifest.activationEvents.includes("onCommand:" + command.id), true);
    }
  });

  it("样式表同时覆盖输入框按钮与角落按钮", function () {
    const css = readFileSync(new URL("../renderer/styles.mjs", import.meta.url), "utf8");
    assert.equal(css.includes(".pov-btn"), true);
    assert.equal(css.includes(".pov-corner"), true);
    // 铺满视口的盒子必须不吃点击，否则会挡住界面
    assert.equal(/\.pov-corner\s*\{[^}]*pointer-events:\s*none/.test(css), true);
    assert.equal(/\.pov-corner\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/.test(css), true);
  });
});
