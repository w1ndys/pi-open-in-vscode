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
    commands: {
      register: async function (descriptor) {
        globalThis.pi.registered = descriptor;
      },
      unregister: async function () {},
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

  it("没有工作目录时只提示，不拉起命令", async function () {
    const toasts = installFakePi(null);
    let launched = 0;
    const runner = async function () {
      launched += 1;
    };
    const result = await main.onRendererCall(main.OPEN_METHOD, {}, runner);
    assert.equal(result.code, "NO_WORKSPACE");
    assert.equal(launched, 0);
    assert.equal(toasts[0], "当前没有工作目录，先打开一个项目。");
  });

  it("成功时用第一条命令并提示同一句话", async function () {
    const toasts = installFakePi({ path: "/tmp/demo" });
    const launched = [];
    const runner = async function (command) {
      launched.push(command);
    };
    const result = await main.onRendererCall(main.OPEN_METHOD, {}, runner);
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
    const result = await main.onRendererCall(main.OPEN_METHOD, {}, runner);
    assert.equal(result.method, "code");
    assert.deepEqual(launched, ["/usr/bin/open", "code"]);
    assert.equal(toasts[0], main.SUCCESS_MESSAGE);
  });

  it("两条都失败时给出安装提示", async function () {
    const toasts = installFakePi({ path: "/tmp/demo" });
    const runner = async function () {
      throw new Error("no such command");
    };
    const result = await main.onRendererCall(main.OPEN_METHOD, {}, runner);
    assert.equal(result.code, "OPEN_FAILED");
    assert.equal(result.message, "打不开 VSCode。请确认已安装 Visual Studio Code。");
    assert.equal(toasts[0], result.message);
  });
});

describe("斜杠命令", function () {
  it("onLoad 仍注册原来的命令 id 与标题", async function () {
    installFakePi({ path: "/tmp/demo" });
    await main.onLoad();
    assert.equal(globalThis.pi.registered.id, main.COMMAND_ID);
    assert.equal(globalThis.pi.registered.title, main.COMMAND_TITLE);
    assert.equal(typeof globalThis.pi.registered.run, "function");
  });
});
