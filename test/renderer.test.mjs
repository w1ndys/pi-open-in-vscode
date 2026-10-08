/**
 * 渲染器模块单测：用假 DOM 加载渲染器入口，不启动宿主。
 *
 * 这个模块不依赖 react、也不注册插槽，所以测试只需要一个能回答
 * querySelector / elementFromPoint 的假文档，和一个能手动触发的假 MutationObserver。
 * 显示逻辑用 renderer.sync() 直接驱动，只有观察器那条路要等一次合并延迟。
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { copyFor, labelFor, createCornerButton, openCornerButton } from "../renderer/corner.mjs";
import { stackCornerButton, CORNER_BUTTON_ATTR, CORNER_GAP_PX } from "../renderer/corner-stack.mjs";

const renderer = await import("../renderer/index.mjs");

// 业务层是 CommonJS，用 createRequire 在 ESM 里加载它做字面量比对
const require = createRequire(import.meta.url);
const business = require("../business/pi-open-in-vscode.js");

/** 假观察器收到的实例，测试用来手动触发一次「DOM 变了」。 */
const observers = [];

/**
 * 假元素：只实现渲染器与按钮用到的几个方法。
 * rect 决定「有没有尺寸」，父链决定 contains。
 */
function makeElement(tagName) {
  const listeners = {};
  const element = {
    tagName: tagName,
    className: "",
    textContent: "",
    title: "",
    disabled: false,
    children: [],
    attributes: {},
    style: {},
    parent: null,
    rect: { left: 0, top: 0, width: 100, height: 40 },
    appendChild: function (child) {
      child.parent = this;
      this.children.push(child);
      return child;
    },
    remove: function () {
      // 从父节点上摘掉自己，模拟宿主收层
      if (!this.parent) {
        return;
      }
      const siblings = this.parent.children;
      const index = siblings.indexOf(this);
      // 找得到才摘，找不到说明已经被摘过
      if (index >= 0) {
        siblings.splice(index, 1);
      }
      this.parent = null;
    },
    setAttribute: function (name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute: function (name) {
      // 没有就是 null，和浏览器一致
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
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
    getBoundingClientRect: function () {
      return this.rect;
    },
    contains: function (node) {
      // 沿父链往上找，和浏览器的 contains 语义一致
      let cursor = node;
      while (cursor) {
        // 找到自己就说明在子树里
        if (cursor === this) {
          return true;
        }
        cursor = cursor.parent;
      }
      return false;
    },
  };
  return element;
}

/**
 * 假文档：只回答渲染器真正会问的几个选择器。
 * @param {object} options { composer, settingsOpen, hit }
 */
function fakeDocument(options) {
  const settings = options || {};
  const doc = {
    documentElement: makeElement("html"),
    composer: settings.composer || null,
    settingsElement: settings.settingsOpen === true ? makeElement("div") : null,
    hit: settings.hit || null,
    stale: [],
    cornerButtons: settings.cornerButtons || [],
    createElement: makeElement,
    querySelector: function (selector) {
      // 设置页：整页界面盖住对话
      if (selector === ".app-shell.settings-mode") {
        return doc.settingsElement;
      }
      // 输入框：显示逻辑的依据
      if (selector === ".composer-shell") {
        return doc.composer;
      }
      return null;
    },
    querySelectorAll: function (selector) {
      // 残留层：加载时清掉
      if (selector === ".pov-corner") {
        return doc.stale;
      }
      // 输入框可能有多个（首页与停靠两种形态），返回存在的那些
      if (selector === ".composer-shell") {
        return doc.composer ? [doc.composer] : [];
      }
      // 右下角按钮带：由测试自己决定这一轮有哪些按钮
      if (selector === "[data-pi-corner-button]") {
        return doc.cornerButtons;
      }
      return [];
    },
    elementFromPoint: function () {
      return doc.hit;
    },
  };
  return doc;
}

/**
 * 假 MutationObserver：记下回调与目标，测试自己决定什么时候触发。
 */
function FakeObserver(callback) {
  this.callback = callback;
  this.target = null;
  this.disconnected = false;
  observers.push(this);
}

FakeObserver.prototype.observe = function (target) {
  this.target = target;
};

FakeObserver.prototype.disconnect = function () {
  this.disconnected = true;
};

// Node 里没有 MutationObserver，装一个假的给模块用
globalThis.MutationObserver = FakeObserver;

/** 假观察器收到的最后一个实例，用来触发一次检查。 */
function latestObserver() {
  return observers[observers.length - 1];
}

/**
 * 等一会儿，让微任务与合并延迟都跑完。
 * @param {number} [delayMs] 等待毫秒数
 */
function settle(delayMs) {
  return new Promise(function (resolve) {
    globalThis.setTimeout(resolve, delayMs || 0);
  });
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
 * @param {object} [options] { hasWorkspace, openResult }
 */
function fakePi(options) {
  const settings = options || {};
  const calls = { styles: [], slots: [], dispatches: [], layersOpened: 0, layersClosed: 0 };
  const layerElement = makeElement("div");
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
      // 打开失败：没有项目根（临时会话）
      if (settings.openResult === "noproject") {
        return Promise.resolve({ ok: false, code: "NO_PROJECT_ROOT", message: "没有工作区。" });
      }
      // 打开失败：别的错误，界面该原样报错
      if (settings.openResult === "fail") {
        return Promise.resolve({ ok: false, code: "OPEN_FAILED", message: "打不开。" });
      }
      return Promise.resolve({ ok: true, dir: "/tmp/demo" });
    },
  };
  return { calls: calls, pi: pi, layerElement: layerElement };
}

/**
 * 装好假文档与假 pi，但先不加载插件。
 * @param {object} [options] { composer, hasWorkspace, openResult, ... }
 * @returns {object} { fake, doc }
 */
function setup(options) {
  const settings = options || {};
  const fake = fakePi(settings);
  const doc = fakeDocument(settings);
  // 没显式给命中目标时，命中测试默认返回输入框自己：也就是"露在屏幕上"
  if (!settings.hit) {
    doc.hit = doc.composer;
  }
  globalThis.document = doc;
  return { fake: fake, doc: doc };
}

/**
 * 加载插件并等第一次检查跑完。
 * @param {object} [options] 同 setup
 * @returns {Promise<object>} { fake, doc }
 */
async function boot(options) {
  const booted = setup(options);
  renderer.onLoad(booted.fake.pi);
  // 首次检查是合并后跑的，等过合并延迟
  await settle(80);
  return booted;
}

/** 只取派发的方法名，断言更直观。 */
function methodsOf(fake) {
  return fake.calls.dispatches.map(function (item) {
    return item.payload.method;
  });
}

afterEach(function () {
  renderer.onUnload();
  delete globalThis.document;
  observers.length = 0;
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

  it("初始空闲并写明只在对话界面里出现", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, { copy: copyFor("zh-CN"), invoke: function () {} });
    assert.equal(ui.phase(), "idle");
    assert.equal(ui.button.textContent, "VSCode");
    assert.equal(ui.button.title, "用 VSCode 打开当前项目根；只在对话界面里出现。");
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

  it("成功后显示已打开", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, {
      copy: copyFor("zh-CN"),
      invoke: function () {
        return Promise.resolve({ ok: true });
      },
    });
    ui.click();
    return Promise.resolve().then(function () {
      assert.equal(ui.phase(), "done");
      assert.equal(ui.button.textContent, "已打开");
      assert.equal(ui.button.disabled, false);
    });
  });

  it("失败时把原因写进悬停提示", function () {
    const doc = fakeDocument();
    const ui = createCornerButton(doc, {
      copy: copyFor("zh-CN"),
      invoke: function () {
        return Promise.resolve({ ok: false, message: "本次对话没有工作区。" });
      },
    });
    ui.click();
    return Promise.resolve().then(function () {
      assert.equal(ui.phase(), "fail");
      assert.equal(ui.button.textContent, "失败");
      assert.equal(ui.button.title, "本次对话没有工作区。");
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
    assert.equal(corner.element.className, "pov-corner");
    assert.equal(corner.button.className, "pov-corner-btn");
    // 加入按钮带的标记要在
    assert.equal(corner.button.getAttribute(CORNER_BUTTON_ATTR), "");
    corner.close();
    assert.equal(fake.calls.layersClosed, 1);
  });
});

describe("右下角按钮带", function () {
  /** 造一个只回答按钮带选择器的假文档。 */
  function stackDoc(list) {
    return {
      querySelectorAll: function () {
        return list;
      },
    };
  }

  /** 造一颗有高度的假按钮。 */
  function buttonOf(height) {
    const button = makeElement("button");
    button.rect = { left: 0, top: 0, width: 100, height: height };
    return button;
  }

  it("靠前的贴右下角，靠后的按下面几颗的高度往上让位", function () {
    const first = buttonOf(30);
    const second = buttonOf(40);
    const doc = stackDoc([first, second]);
    stackCornerButton(doc, first);
    stackCornerButton(doc, second);
    // 第一颗不让位
    assert.equal(first.style.transform, "");
    // 第二颗让到第一颗上面，中间留一个间距
    assert.equal(second.style.transform, "translateY(-" + (30 + CORNER_GAP_PX) + "px)");
  });

  it("只写自己的样式，不碰别家的按钮", function () {
    const first = buttonOf(30);
    const second = buttonOf(40);
    stackCornerButton(stackDoc([first, second]), second);
    assert.equal(first.style.transform, undefined);
  });

  it("隐藏（高度为 0）的按钮不占位", function () {
    const first = buttonOf(30);
    const hidden = buttonOf(0);
    const third = buttonOf(40);
    stackCornerButton(stackDoc([first, hidden, third]), third);
    assert.equal(third.style.transform, "translateY(-" + (30 + CORNER_GAP_PX) + "px)");
  });

  it("自己还没挂进文档：什么都不做，也不报错", function () {
    const mine = buttonOf(20);
    stackCornerButton(stackDoc([buttonOf(30)]), mine);
    assert.equal(mine.style.transform, undefined);
  });

  it("重复排一次结果不变", function () {
    const first = buttonOf(30);
    const second = buttonOf(40);
    const doc = stackDoc([first, second]);
    stackCornerButton(doc, second);
    const once = second.style.transform;
    stackCornerButton(doc, second);
    assert.equal(second.style.transform, once);
  });

  it("间距是约定好的固定值", function () {
    assert.equal(CORNER_GAP_PX, 8);
  });
});

describe("渲染器 onLoad", function () {
  it("注入样式、清掉残留层、开始盯 DOM，但不再注册插槽", async function () {
    const booted = setup({ composer: makeElement("div") });
    // 上一轮实例留下的层，挂在真实父节点下
    const holder = makeElement("div");
    const staleLayer = holder.appendChild(makeElement("div"));
    booted.doc.stale.push(staleLayer);
    renderer.onLoad(booted.fake.pi);
    assert.equal(booted.fake.calls.styles.length, 1);
    // 输入框按钮已经去掉：模块不再注册任何插槽
    assert.deepEqual(booted.fake.calls.slots, []);
    // 残留层被摘掉，不会留在窗口上
    assert.equal(holder.children.length, 0);
    assert.equal(latestObserver().target, booted.doc.documentElement);
    // 层要等首次检查跑完才开
    await settle(80);
    assert.equal(booted.fake.calls.layersOpened, 1);
  });

  it("DOM 一变动就重新检查（页面切换靠这条兜住）", async function () {
    const booted = await boot({ composer: makeElement("div") });
    assert.equal(booted.fake.calls.layersOpened, 1);
    // 宿主切到定时任务页：输入框从 DOM 里消失
    booted.doc.composer = null;
    latestObserver().callback();
    // 检查是合并后跑的，等过合并延迟
    await settle(80);
    assert.equal(booted.fake.calls.layersClosed, 1);
  });
});

describe("只在对话界面里显示", function () {
  it("有输入框且有工作区：开层，按钮画在层里", async function () {
    const booted = await boot({ composer: makeElement("div") });
    assert.equal(booted.fake.calls.layersOpened, 1);
    assert.equal(booted.fake.layerElement.children.length, 1);
    assert.equal(booted.fake.layerElement.children[0].className, "pov-corner");
  });

  it("没有输入框（定时任务页、插件页、启动中）：不开层", async function () {
    const booted = await boot();
    assert.equal(booted.fake.calls.layersOpened, 0);
    assert.deepEqual(booted.fake.calls.dispatches, []);
  });

  it("设置页打开：对话还挂着也不显示", async function () {
    const booted = await boot({ composer: makeElement("div") });
    assert.equal(booted.fake.calls.layersOpened, 1);
    // 宿主切到设置页：对话的 DOM 还在，只是被盖住
    booted.doc.settingsElement = makeElement("div");
    renderer.sync();
    assert.equal(booted.fake.calls.layersClosed, 1);
  });

  it("输入框被别的整页界面盖住（命中测试不是自己）：不显示", async function () {
    const booted = await boot({ composer: makeElement("div"), hit: makeElement("div") });
    assert.equal(booted.fake.calls.layersOpened, 0);
  });

  it("输入框没有尺寸：不显示", async function () {
    const composer = makeElement("div");
    composer.rect = { left: 0, top: 0, width: 0, height: 0 };
    const booted = await boot({ composer: composer });
    assert.equal(booted.fake.calls.layersOpened, 0);
  });

  it("命中点是输入框里面的元素：照常显示", async function () {
    const composer = makeElement("div");
    const inner = composer.appendChild(makeElement("textarea"));
    const booted = await boot({ composer: composer, hit: inner });
    assert.equal(booted.fake.calls.layersOpened, 1);
  });

  it("没有工作区：不显示，而且只探测一次", async function () {
    const booted = await boot({ composer: makeElement("div"), hasWorkspace: false });
    assert.equal(booted.fake.calls.layersOpened, 0);
    // 探测只读工作区，不打开任何东西
    assert.deepEqual(methodsOf(booted.fake), ["hasWorkspace"]);
  });

  it("探测被宿主拒绝：按没有工作区处理", async function () {
    const booted = setup({ composer: makeElement("div") });
    booted.fake.pi.dispatch = function (action, payload) {
      booted.fake.calls.dispatches.push({ action: action, payload: payload });
      return Promise.reject({ code: "PLUGIN_CALL_FAILED", message: "问不到。" });
    };
    renderer.onLoad(booted.fake.pi);
    await settle();
    assert.equal(booted.fake.calls.layersOpened, 0);
  });

  it("从别的页面切回对话界面：重新问一次再显示", async function () {
    const booted = await boot();
    assert.equal(booted.fake.calls.layersOpened, 0);
    // 回到对话界面
    booted.doc.composer = makeElement("div");
    booted.doc.hit = booted.doc.composer;
    renderer.sync();
    await settle();
    assert.equal(booted.fake.calls.layersOpened, 1);
    assert.deepEqual(methodsOf(booted.fake), ["hasWorkspace"]);
  });

  it("卸载后不再盯 DOM，也不留着层", async function () {
    const booted = await boot({ composer: makeElement("div") });
    assert.equal(booted.fake.calls.layersOpened, 1);
    renderer.onUnload();
    assert.equal(booted.fake.calls.layersClosed, 1);
    assert.equal(latestObserver().disconnected, true);
  });
});

describe("点击", function () {
  it("派发 plugin.call 调 openWorkspace", async function () {
    const booted = await boot({ composer: makeElement("div") });
    const button = booted.fake.layerElement.children[0].children[0];
    button.click();
    await settle();
    const opens = booted.fake.calls.dispatches.filter(function (item) {
      return item.payload.method === "openWorkspace";
    });
    assert.deepEqual(opens, [
      { action: "plugin.call", payload: { method: "openWorkspace", args: {} } },
    ]);
  });

  it("别的失败原样返回，按钮不收", async function () {
    const booted = await boot({ composer: makeElement("div"), openResult: "fail" });
    const value = await renderer.runOpen();
    assert.equal(value.code, "OPEN_FAILED");
    assert.equal(booted.fake.calls.layersClosed, 0);
  });

  it("会话切走、按钮还在时点一次：说明原因，稍后把按钮收掉", async function () {
    const booted = await boot({ composer: makeElement("div"), openResult: "noproject" });
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const scheduled = [];
    globalThis.setTimeout = function (task, delayMs) {
      scheduled.push({ task: task, delayMs: delayMs });
      return scheduled.length;
    };
    globalThis.clearTimeout = function () {};
    try {
      const value = await renderer.runOpen();
      assert.equal(value.ok, false);
      assert.equal(value.code, renderer.NO_SESSION_DIR_CODE);
      assert.equal(value.message, renderer.NO_WORKSPACE_MESSAGE);
      // 原因先留在按钮上，稍后才收
      assert.equal(booted.fake.calls.layersClosed, 0);
      const hide = scheduled.filter(function (item) {
        return item.delayMs === renderer.HIDE_AFTER_FAIL_MS;
      })[0];
      assert.ok(hide, "应当安排一次延迟收按钮");
      hide.task();
      assert.equal(booted.fake.calls.layersClosed, 1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});

describe("结果常量", function () {
  it("没有工作区时的错误码与业务层一致", function () {
    // 防漂移：两边不一致时按钮不会把自己收掉，而是把入口层的报错亮出来
    assert.equal(renderer.NO_PROJECT_ROOT_CODE, business.NO_PROJECT_ROOT_CODE);
  });
});

describe("manifest 与代码一致", function () {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const source = readFileSync(new URL("../renderer/index.mjs", import.meta.url), "utf8");

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

  it("不再声明 Agent 扩展与 agent.extension 权限", function () {
    // 摘掉的原因见 manifest.changelog：那条路在临时会话里拿不到会话目录，
    // 在有工作区的对话里又与 /vscode 完全等效，却要一个能在 sidecar 里执行命令的重权限
    assert.equal(manifest.permissions.includes("agent.extension"), false);
    assert.equal(manifest.contributes.agentExtensions, undefined);
  });

  it("开机自启并覆盖命令", function () {
    assert.equal(manifest.activationEvents.includes("onStartup"), true);
    for (const command of manifest.contributes.commands) {
      assert.equal(manifest.activationEvents.includes("onCommand:" + command.id), true);
    }
  });

  it("渲染器不再注册插槽、不引用 react，也不往输入框里塞东西", function () {
    // 输入框按钮已按用户要求去掉，页面判断改盯 DOM；直接读源码禁止这些悄悄回来
    assert.equal(source.includes("slots.register"), false);
    assert.equal(source.includes('"react"'), false);
    assert.equal(source.includes("vscode-here"), false);
    assert.equal(source.includes("composer.insertText"), false);
  });

  it("角落按钮带共享标记，能和别的插件排开", function () {
    const cornerSource = readFileSync(new URL("../renderer/corner.mjs", import.meta.url), "utf8");
    assert.equal(cornerSource.includes("CORNER_BUTTON_ATTR"), true);
    assert.equal(cornerSource.includes("setAttribute"), true);
    // 让位用 transform，不改布局，别家才能量到真实高度
    assert.equal(source.includes("stackCornerButton"), true);
  });

  it("样式表只剩角落按钮", function () {
    const css = readFileSync(new URL("../renderer/styles.mjs", import.meta.url), "utf8");
    assert.equal(css.includes(".pov-corner"), true);
    // 铺满视口的盒子必须不吃点击，否则会挡住界面
    assert.equal(/\.pov-corner\s*\{[^}]*pointer-events:\s*none/.test(css), true);
    assert.equal(/\.pov-corner\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/.test(css), true);
    // 输入框那一行的按钮已经删掉，样式里不该再留着
    assert.equal(css.includes(".pov-btn"), false);
    assert.equal(css.includes(".pov-out"), false);
  });
});
