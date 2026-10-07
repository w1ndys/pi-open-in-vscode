/**
 * 渲染器模块单测：用桩 react 加载插件自己的渲染器入口，不启动宿主。
 * 角落按钮走自绘层，DOM 由这里的假实现顶替。
 *
 * 注意：桩里的 useState 不会触发重渲染，所以「按钮画出来了没有」用再挂一次插槽来看
 * ——宿主换会话时本来就会重挂插槽，这条路径和真实行为一致。
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { copyFor, labelFor, createCornerButton, openCornerButton } from "../renderer/corner.mjs";

// 先装解析钩子，import 才会把 react 解析到桩上
register("./fixtures/react-resolver.mjs", import.meta.url);
const renderer = await import("../renderer/index.mjs");

// 业务层是 CommonJS，用 createRequire 在 ESM 里加载它做字面量比对
const require = createRequire(import.meta.url);
const business = require("../business/pi-open-in-vscode.js");

// 桩里的清理函数，用来模拟「组件卸载」与「页面切走」
const { cleanups } = await import("./fixtures/react-stub.mjs");

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
 * 按方法名分别回答：hasWorkspace 是显示按钮前的探测，openWorkspace 是真正打开。
 * @param {object} [options] { hasWorkspace, openResult }
 */
function fakePi(options) {
  const settings = options || {};
  const calls = { styles: [], slots: [], dispatches: [], layersOpened: 0, layersClosed: 0 };
  const layerElement = fakeDocument().createElement("div");
  const pi = {
    plugin: { id: "io.github.w1ndys.pi-open-in-vscode", version: "0.6.0" },
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
      // 探测：默认这次对话有工作区
      if (payload && payload.method === "hasWorkspace") {
        return Promise.resolve({ ok: true, hasWorkspace: settings.hasWorkspace !== false });
      }
      // 打开失败：这次对话没有工作区（会话切走之后按钮还在，点下去才发现）
      if (settings.openResult === "noproject") {
        return Promise.resolve({ ok: false, code: "NO_PROJECT_ROOT", message: "本次对话没有工作区。" });
      }
      // 打开失败：别的错误，界面该原样报错
      if (settings.openResult === "fail") {
        return Promise.resolve({ ok: false, code: "OPEN_FAILED", message: "打不开。" });
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
  // 未执行的清理函数不该跨用例留下
  cleanups.length = 0;
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

  it("初始是空闲并带说明自己只在有工作区的对话里出现的悬停提示", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, { copy: copyFor("zh-CN"), invoke: function () {} });
    assert.equal(ui.phase(), "idle");
    assert.equal(ui.button.textContent, "VSCode");
    assert.equal(ui.button.title, "用 VSCode 打开当前工作目录；只在有工作区的对话里出现。");
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
  /** 只取打开动作的派发，探测不掺进来。 */
  function opensOf(fake) {
    return fake.calls.dispatches.filter(function (item) {
      return item.payload && item.payload.method === "openWorkspace";
    });
  }

  /** 只取探测的派发。 */
  function probesOf(fake) {
    return fake.calls.dispatches.filter(function (item) {
      return item.payload && item.payload.method === "hasWorkspace";
    });
  }

  /**
   * 挂一次插槽并等探测结算：探测是异步的，宿主挂上组件后就是这样走完的。
   * @param {object} fake fakePi 的返回
   */
  async function mount(fake) {
    const tree = fake.calls.slots[0].component({ position: "right" });
    // 探测结果在两轮微任务内落到状态上
    await Promise.resolve();
    await Promise.resolve();
    return tree;
  }

  /**
   * 拿到按钮画出来之后的那一帧。
   * 桩 useState 不重渲染，所以再挂一次插槽——宿主换会话时就是这样重挂的。
   * @param {object} fake fakePi 的返回
   * @returns {Promise<object | null>} 这一帧的节点
   */
  async function renderButton(fake) {
    await mount(fake);
    return fake.calls.slots[0].component({ position: "right" });
  }

  it("注入样式并注册输入框按钮，不直接挂角落按钮", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    assert.equal(fake.calls.styles.length, 1);
    assert.equal(fake.calls.slots.length, 1);
    assert.equal(fake.calls.slots[0].slot, "composerControl");
    assert.deepEqual(fake.calls.slots[0].positions, ["right"]);
    // 角落按钮跟着插槽走：插槽还没渲染时不该有层
    assert.equal(fake.calls.layersOpened, 0);
    renderer.onUnload();
  });

  it("第一帧先探测，探测完才画按钮", async function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    // 还没探测出结果的那一帧什么都不画，免得闪一下再消失
    const first = await mount(fake);
    assert.equal(first, null);
    assert.equal(probesOf(fake).length, 1);
    // 探测只读出结论，不打开任何东西
    assert.deepEqual(opensOf(fake), []);
    renderer.onUnload();
  });

  it("有工作区时插槽挂上就出现角落按钮，卸载就收掉", async function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    // 渲染插槽 = 宿主在对话界面挂上了它
    await mount(fake);
    assert.equal(fake.calls.layersOpened, 1);
    assert.equal(fake.layerElement.children.length, 1);
    assert.equal(fake.layerElement.children[0].className, "pov-corner");
    renderer.onUnload();
    assert.equal(fake.calls.layersClosed, 1);
  });

  it("没有工作区时不挂角落按钮", async function () {
    const fake = fakePi({ hasWorkspace: false });
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    await mount(fake);
    assert.equal(fake.calls.layersOpened, 0);
    renderer.onUnload();
  });

  it("插槽撤走时收掉角落按钮（页面切走）", async function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    await mount(fake);
    assert.equal(fake.calls.layersOpened, 1);
    // 插槽的清理函数就是宿主切走页面时调的那个
    assert.equal(cleanups.length, 1);
    cleanups.splice(0).forEach(function (run) {
      run();
    });
    assert.equal(fake.calls.layersClosed, 1);
    renderer.onUnload();
  });

  it("重复挂载不会叠出第二个按钮", async function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    await mount(fake);
    await mount(fake);
    assert.equal(fake.calls.layersOpened, 1);
    // 只撤掉一个挂载点时层要留着
    cleanups.splice(0, 1).forEach(function (run) {
      run();
    });
    assert.equal(fake.calls.layersClosed, 0);
    cleanups.splice(0).forEach(function (run) {
      run();
    });
    assert.equal(fake.calls.layersClosed, 1);
    renderer.onUnload();
  });

  it("会话切到没有工作区时，下一次点按钮就把按钮和角落层一起撤掉", async function () {
    const fake = fakePi({ openResult: "noproject" });
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    // 挂上来时探测说有工作区，按钮出现了
    const tree = await renderButton(fake);
    assert.equal(tree.type, "span");
    assert.equal(fake.calls.layersOpened, 1);
    // 会话已经切走（渲染器拿不到切换通知），点下去才发现没有工作区
    const value = await renderer.runOpen();
    assert.equal(value.code, renderer.NO_SESSION_DIR_CODE);
    // 角落按钮先收掉，输入框那行下次重挂时不再画按钮
    assert.equal(fake.calls.layersClosed, 1);
    assert.equal(fake.calls.slots[0].component({ position: "right" }), null);
    renderer.onUnload();
  });
});

describe("按钮组件", function () {
  /** 挂上插槽再挂一次，拿到按钮画出来之后的那一帧。 */
  async function buttonOf(fake) {
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    await fake.calls.slots[0].component({ position: "right" });
    await Promise.resolve();
    const span = fake.calls.slots[0].component({ position: "right" });
    return span.props.children[0];
  }

  it("有工作区时渲染出一个可点击的按钮", async function () {
    const fake = fakePi();
    const button = await buttonOf(fake);
    assert.equal(button.type, "button");
    assert.equal(button.props.disabled, false);
    assert.equal(button.props["aria-label"], "用 VSCode 打开当前工作目录");
    renderer.onUnload();
  });

  it("没有工作区时这一行什么都不画", async function () {
    const fake = fakePi({ hasWorkspace: false });
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    await fake.calls.slots[0].component({ position: "right" });
    await Promise.resolve();
    assert.equal(fake.calls.slots[0].component({ position: "right" }), null);
    renderer.onUnload();
  });

  it("点击派发 plugin.call 调 openWorkspace", async function () {
    const fake = fakePi();
    const button = await buttonOf(fake);
    button.props.onClick();
    const opens = fake.calls.dispatches.filter(function (item) {
      return item.payload.method === "openWorkspace";
    });
    assert.deepEqual(opens, [
      { action: "plugin.call", payload: { method: "openWorkspace", args: {} } },
    ]);
    renderer.onUnload();
  });

  it("两条入口派发的是同一个调用", async function () {
    const fake = fakePi();
    const button = await buttonOf(fake);
    button.props.onClick();
    // 角落按钮走同一条路径
    const cornerButton = fake.layerElement.children[0].children[0];
    cornerButton.click();
    const opens = fake.calls.dispatches.filter(function (item) {
      return item.payload.method === "openWorkspace";
    });
    assert.equal(opens.length, 2);
    assert.deepEqual(opens[0], opens[1]);
    renderer.onUnload();
  });
});

describe("结果文案", function () {
  it("成功时不显示文字", function () {
    assert.equal(renderer.messageFor({ ok: true, dir: "/tmp/demo" }), "");
  });

  it("失败时用插件给的说明", function () {
    const value = { ok: false, code: "NO_PROJECT_ROOT", message: "本次对话没有工作区。" };
    assert.equal(renderer.messageFor(value), "本次对话没有工作区。");
  });

  it("没有说明时给通用文案", function () {
    assert.equal(renderer.messageFor({ ok: false }), "打开失败。");
    assert.equal(renderer.messageFor(null), "打开失败。");
  });

  it("成功不写话，失败用错误色", function () {
    assert.equal(renderer.resultKind({ ok: true }), "");
    assert.equal(renderer.resultKind({ ok: false, code: "OPEN_FAILED" }), "error");
  });

  it("宿主超时单独提示", function () {
    assert.equal(renderer.errorText({ code: "PLUGIN_CALL_TIMEOUT" }), "打开超时。");
  });

  it("其他拒绝用错误码兜底", function () {
    assert.equal(renderer.errorText({ code: "PLUGIN_ACTION_UNDECLARED" }), "打开失败。");
  });
});

describe("没有工作区的处理", function () {
  /** 只取动作与方法名，断言派发内容更方便。 */
  function callsOf(fake) {
    return fake.calls.dispatches.map(function (item) {
      return item.payload.method;
    });
  }

  it("没有工作区时只说明一句，不给替代入口", function () {
    const fake = fakePi({ openResult: "noproject" });
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    return renderer.runOpen().then(function (value) {
      // 只调了打开这一个方法：既不猜目录，也不往输入框里塞命令
      assert.deepEqual(callsOf(fake), ["openWorkspace"]);
      assert.equal(value.ok, false);
      assert.equal(value.code, renderer.NO_SESSION_DIR_CODE);
      assert.equal(value.message, renderer.NO_WORKSPACE_MESSAGE);
      renderer.onUnload();
    });
  });

  it("别的失败原样返回", function () {
    const fake = fakePi({ openResult: "fail" });
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    return renderer.runOpen().then(function (value) {
      assert.deepEqual(callsOf(fake), ["openWorkspace"]);
      assert.equal(value.ok, false);
      assert.equal(value.code, "OPEN_FAILED");
      renderer.onUnload();
    });
  });

  it("有项目根时正常返回", function () {
    const fake = fakePi();
    globalThis.document = fakeDocument();
    renderer.onLoad(fake.pi);
    return renderer.runOpen().then(function (value) {
      assert.deepEqual(callsOf(fake), ["openWorkspace"]);
      assert.equal(value.dir, "/tmp/demo");
      renderer.onUnload();
    });
  });
});

describe("manifest 与代码一致", function () {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  it("声明了渲染器模块与 renderer.extension 权限", function () {
    assert.equal(manifest.renderer, "renderer/index.mjs");
    assert.equal(manifest.permissions.includes("renderer.extension"), true);
  });

  it("白名单只留打开与探测两个方法，动作只剩 plugin.call", function () {
    assert.deepEqual(manifest.rendererActions, ["plugin.call"]);
    assert.deepEqual(manifest.rendererCallMethods, ["hasWorkspace", "openWorkspace"]);
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
    // 说明与失败各有一份样式
    assert.equal(css.includes('[data-pov-result="hint"]'), true);
    assert.equal(css.includes('[data-pov-result="error"]'), true);
  });

  it("不再声明 Agent 扩展与 agent.extension 权限", function () {
    // 摘掉的原因见 manifest.changelog：那条路在临时会话里拿不到会话目录，
    // 在有工作区的对话里又与 /vscode 完全等效，却要一个能在 sidecar 里执行命令的重权限
    assert.equal(manifest.permissions.includes("agent.extension"), false);
    assert.equal(manifest.contributes.agentExtensions, undefined);
  });

  it("渲染器不再引用扩展命令，也不再往输入框里塞东西", function () {
    // 交接与扩展都撤掉了。直接读源码断言，防止这条被撤掉的路悄悄回来。
    const source = readFileSync(new URL("../renderer/index.mjs", import.meta.url), "utf8");
    assert.equal(source.includes("vscode-here"), false);
    assert.equal(source.includes("composer.insertText"), false);
    assert.equal(source.includes("composer.readDraft"), false);
  });
});

describe("跨模块字面量一致", function () {
  it("渲染器认的「没有工作区」错误码与业务层相同", function () {
    // 防漂移：两边不一致时按钮会把入口层的报错直接亮给用户，而不是把自己撤掉
    assert.equal(renderer.NO_PROJECT_ROOT_CODE, business.NO_PROJECT_ROOT_CODE);
  });
});
