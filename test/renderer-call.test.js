/**
 * 主进程入口单测：按钮路径与斜杠命令，都不真拉起 VSCode。
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const main = require("../main");

/**
 * 装上假的 pi，返回收集到 toast 的数组。
 * @param {{ path: string } | null} workspace 宿主给的工作区
 */
function installFakePi(workspace) {
  const toasts = [];
  globalThis.pi = {
    workspace: {
      get: async function () {
        return workspace;
      },
    },
    ui: {
      showToast: async function (message) {
        toasts.push(message);
      },
    },
    // 按顺序记下注册/注销过的命令
    registered: [],
    unregistered: [],
    commands: {
      register: async function (descriptor) {
        globalThis.pi.registered.push(descriptor);
      },
      unregister: async function (id) {
        globalThis.pi.unregistered.push(id);
      },
    },
  };
  return toasts;
}

describe("onRendererCall", function () {
  it("未知方法直接拒绝", async function () {
    installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall("nope", {});
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_METHOD");
  });

  it("探测有工作区时回 hasWorkspace: true，且一次命令都不拉起", async function () {
    installFakePi({ path: "/tmp/demo" });
    const launched = [];
    const runner = async function (command) {
      launched.push(command);
    };
    const result = await main.onRendererCall(main.PROBE_ACTION, {}, runner);
    assert.equal(result.ok, true);
    assert.equal(result.hasWorkspace, true);
    // 探测只读工作区，绝不打开任何东西
    assert.deepEqual(launched, []);
  });

  it("没有项目根时探测回 hasWorkspace: false", async function () {
    installFakePi(null);
    const result = await main.onRendererCall(main.PROBE_ACTION, {});
    assert.equal(result.ok, true);
    assert.equal(result.hasWorkspace, false);
  });

  it("读工作区报错时也当没有工作区，按钮不出现", async function () {
    installFakePi({ path: "/tmp/demo" });
    globalThis.pi.workspace.get = async function () {
      throw new Error("host busy");
    };
    const result = await main.onRendererCall(main.PROBE_ACTION, {});
    assert.equal(result.ok, true);
    assert.equal(result.hasWorkspace, false);
  });

  it("没有项目根时按 NO_PROJECT_ROOT 拒绝，且不拉起任何命令", async function () {
    const toasts = installFakePi(null);
    const launched = [];
    const runner = async function (command) {
      launched.push(command);
    };
    const result = await main.onRendererCall(main.OPEN_ACTION, {}, runner);
    assert.equal(result.ok, false);
    assert.equal(result.code, main.NO_PROJECT_ROOT_CODE);
    // 临时会话不猜目录：一次命令都不该拉起来
    assert.deepEqual(launched, []);
    // 这是 /vscode 命令在临时会话里唯一看到的文案：说清没有工作区，不给替代入口
    assert.equal(result.message, main.NO_PROJECT_ROOT_MESSAGE);
    assert.match(result.message, /没有工作区/);
    assert.equal(toasts[0], main.NO_PROJECT_ROOT_MESSAGE);
  });

  it("成功时用第一条命令并提示同一句话", async function () {
    const toasts = installFakePi({ path: "/tmp/demo" });
    const launched = [];
    const runner = async function (command) {
      launched.push(command);
    };
    const result = await main.onRendererCall(main.OPEN_ACTION, {}, runner);
    assert.equal(result.ok, true);
    assert.equal(result.dir, "/tmp/demo");
    assert.equal(result.method, "open");
    assert.deepEqual(launched, ["/usr/bin/open"]);
    assert.equal(toasts[0], main.SUCCESS_MESSAGE);
  });

  it("第一条命令失败时退到第二条", async function () {
    const toasts = installFakePi({ path: "/tmp/demo" });
    const launched = [];
    const runner = async function (command) {
      launched.push(command);
      // 只有 macOS 的 open 失败
      if (command === "/usr/bin/open") {
        throw new Error("no such command");
      }
    };
    const result = await main.onRendererCall(main.OPEN_ACTION, {}, runner);
    assert.equal(result.method, "code");
    assert.deepEqual(launched, ["/usr/bin/open", "code"]);
    assert.equal(toasts[0], main.SUCCESS_MESSAGE);
  });

  it("两条都失败时给出安装提示", async function () {
    const toasts = installFakePi({ path: "/tmp/demo" });
    const runner = async function () {
      throw new Error("no such command");
    };
    const result = await main.onRendererCall(main.OPEN_ACTION, {}, runner);
    assert.equal(result.code, "OPEN_FAILED");
    assert.equal(result.message, "打不开 VSCode。请确认已安装 Visual Studio Code。");
    assert.equal(toasts[0], result.message);
  });
});

describe("目录来源", function () {
  it("resolveOpenDir 只读项目根：有就返回，没有就是 null", async function () {
    installFakePi({ path: "/tmp/project" });
    assert.equal(await main.resolveOpenDir(), "/tmp/project");
    installFakePi(null);
    // 临时会话不去拼任何目录
    assert.equal(await main.resolveOpenDir(), null);
  });

  it("路径为空串时也当没有项目根", async function () {
    installFakePi({ path: "   " });
    assert.equal(await main.resolveOpenDir(), null);
  });
});

describe("斜杠命令", function () {
  it("onLoad 只注册一条命令，onUnload 注销它", async function () {
    installFakePi({ path: "/tmp/demo" });
    await main.onLoad();
    const first = globalThis.pi.registered[0];
    assert.equal(first.id, main.COMMAND_ID);
    assert.equal(first.title, main.COMMAND_TITLE);
    assert.equal(typeof first.run, "function");
    // 现在只有这一条命令；两个界面按钮由渲染器自己挂
    assert.equal(globalThis.pi.registered.length, 1);
    await main.onUnload();
    assert.deepEqual(globalThis.pi.unregistered, [main.COMMAND_ID]);
  });

  it("临时会话里跑命令只说明没有工作区，不拉起命令", async function () {
    const toasts = installFakePi(null);
    await main.onLoad();
    await globalThis.pi.registered[0].run();
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /没有工作区/);
  });
});
