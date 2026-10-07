/**
 * Agent 扩展单测：用假 pi 加载扩展模块，不启动宿主、不真开 VS Code。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import extension, {
  COMMAND_NAME,
  resolveDirectory,
  openInVscode,
  runOpenHere,
} from "../extension.mjs";

// 渲染器模块 import 了 react，先装解析钩子才能在没有宿主的 Node 里加载它
register("./fixtures/react-resolver.mjs", import.meta.url);
const renderer = await import("../renderer/index.mjs");

// 业务层是 CommonJS，用 createRequire 在 ESM 里加载它做字面量比对
const require = createRequire(import.meta.url);
const business = require("../business/pi-open-in-vscode.js");

/**
 * 假的扩展 API：记下注册了什么、exec 收到了什么。
 * @param {object} options { failFirst, failAll }
 */
function fakePi(options) {
  const settings = options || {};
  const calls = { commands: [], execs: [] };
  let seen = 0;
  return {
    calls: calls,
    pi: {
      registerCommand: function (name, descriptor) {
        calls.commands.push({ name: name, descriptor: descriptor });
      },
      exec: async function (command, args) {
        seen += 1;
        calls.execs.push({ command: command, args: args });
        // 前一次失败，用来验证兜底
        if (settings.failFirst && seen === 1) {
          throw new Error("no such command");
        }
        // 全失败，用来验证报错路径
        if (settings.failAll) {
          throw new Error("no such command");
        }
      },
    },
  };
}

describe("扩展注册", function () {
  /** 从记下的注册里按名字找一条；找不到返回 undefined。 */
  function commandNamed(fake, name) {
    return fake.calls.commands.find(function (item) {
      return item.name === name;
    });
  }

  it("注册 /vscode-here，并带上说明", function () {
    const fake = fakePi();
    extension(fake.pi);
    // 只断言这个命令在，不断言总数：诊断期会额外注册探针命令
    const registered = commandNamed(fake, COMMAND_NAME);
    assert.ok(registered, "应当注册 " + COMMAND_NAME);
    assert.equal(typeof registered.descriptor.handler, "function");
    assert.equal(typeof registered.descriptor.description, "string");
  });
});

describe("目录来源", function () {
  it("优先用上下文的 cwd", function () {
    assert.equal(resolveDirectory({ cwd: "/tmp/project" }), "/tmp/project");
  });

  it("空、/ 和 . 都不当目录，避免打开系统根", function () {
    // 临时会话没有项目根时，宿主把扩展 cwd 退回 sidecar 进程目录
    assert.equal(resolveDirectory({}), null);
    assert.equal(resolveDirectory(null), null);
    assert.equal(resolveDirectory({ cwd: "   " }), null);
    assert.equal(resolveDirectory({ cwd: "/" }), null);
    assert.equal(resolveDirectory({ cwd: "." }), null);
  });
});

describe("打开命令", function () {
  it("首选 open -a，并把目录传进去", async function () {
    const fake = fakePi();
    const result = await openInVscode(fake.pi, "/tmp/project");
    assert.equal(result.ok, true);
    assert.equal(result.method, "open");
    assert.equal(result.dir, "/tmp/project");
    assert.deepEqual(fake.calls.execs, [
      { command: "/usr/bin/open", args: ["-a", "Visual Studio Code", "/tmp/project"] },
    ]);
  });

  it("open 失败时退到 code", async function () {
    const fake = fakePi({ failFirst: true });
    const result = await openInVscode(fake.pi, "/tmp/project");
    assert.equal(result.ok, true);
    assert.equal(result.method, "code");
    assert.deepEqual(fake.calls.execs, [
      { command: "/usr/bin/open", args: ["-a", "Visual Studio Code", "/tmp/project"] },
      { command: "code", args: ["/tmp/project"] },
    ]);
  });

  it("两条都失败时返回可读的说明", async function () {
    const fake = fakePi({ failAll: true });
    const result = await openInVscode(fake.pi, "/tmp/project");
    assert.equal(result.ok, false);
    assert.equal(result.message, "打不开 VSCode。请确认已安装 Visual Studio Code，或把 code 命令放进 PATH。");
  });
});

describe("命令处理", function () {
  it("按上下文 cwd 打开，成功时不打扰用户", async function () {
    const fake = fakePi();
    const notified = [];
    const result = await runOpenHere(fake.pi, {
      cwd: "/tmp/project",
      ui: { notify: async function (message) { notified.push(message); } },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(fake.calls.execs[0].args, ["-a", "Visual Studio Code", "/tmp/project"]);
    assert.deepEqual(notified, []);
  });

  it("cwd 是系统根时不拉起命令", async function () {
    const fake = fakePi();
    const result = await runOpenHere(fake.pi, { cwd: "/", ui: { notify: async function () {} } });
    // 打开 / 会把 VS Code 指到系统根，必须取消
    assert.equal(result.ok, false);
    assert.equal(fake.calls.execs.length, 0);
  });

  it("失败时用 ui.notify 说明原因", async function () {
    const fake = fakePi({ failAll: true });
    const notified = [];
    const result = await runOpenHere(fake.pi, {
      cwd: "/tmp/project",
      ui: { notify: async function (message, level) { notified.push({ message: message, level: level }); } },
    });
    assert.equal(result.ok, false);
    assert.equal(notified.length, 1);
    assert.equal(notified[0].level, "error");
    assert.match(notified[0].message, /VSCode/);
  });

  it("没有 ui 时也不报错", async function () {
    const fake = fakePi({ failAll: true });
    const result = await runOpenHere(fake.pi, { cwd: "/tmp/project" });
    assert.equal(result.ok, false);
  });
});

describe("扩展模块契约", function () {
  it("默认导出是接收 pi 的函数", function () {
    assert.equal(typeof extension, "function");
  });

  it("命令名只含小写字母、数字与连字符", function () {
    // 宿主把命令名当 /名字 用，别放会干扰解析的字符
    assert.match(COMMAND_NAME, /^[a-z0-9-]+$/);
  });

  it("渲染器不再引用扩展命令，也不再往输入框里塞东西", function () {
    // 交接已撤掉：临时会话里扩展同样拿不到会话目录。
    // 直接读源码断言，防止这条被撤掉的路悄悄改头换面又回来。
    const source = readFileSync(new URL("../renderer/index.mjs", import.meta.url), "utf8");
    assert.equal(source.includes(COMMAND_NAME), false);
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
