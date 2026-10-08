/**
 * 业务层单测：打开计划怎么编，不真正拉起 VSCode。
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isAbsoluteDir,
  vscodeFileUri,
  buildOpenPlan,
  NO_PROJECT_ROOT_CODE,
  NO_PROJECT_ROOT_MESSAGE,
} = require("../business/pi-open-in-vscode");
const { readWorkspacePath } = require("../data/workspace");
const path = require("node:path");
const { locateWindowsCode, parseRegCodePath } = require("../data/vscode-install");
const { okResult, failResult } = require("../entity/open-result");

describe("isAbsoluteDir", function () {
  it("拒绝空值", function () {
    assert.equal(isAbsoluteDir(""), false);
    assert.equal(isAbsoluteDir(null), false);
  });

  it("接受 POSIX 绝对路径", function () {
    assert.equal(isAbsoluteDir("/Users/w1ndys/project"), true);
  });

  it("接受 Windows 盘符路径", function () {
    assert.equal(isAbsoluteDir("C:\\Users\\w1ndys\\project"), true);
  });
});

describe("vscodeFileUri", function () {
  it("POSIX 目录编成 vscode://file/...", function () {
    assert.equal(vscodeFileUri("/tmp/demo"), "vscode://file/tmp/demo");
  });

  it("Windows 目录补根斜杠", function () {
    assert.equal(vscodeFileUri("C:\\work\\app"), "vscode://file/C:/work/app");
  });
});

describe("buildOpenPlan", function () {
  it("没有目录时落到「没有项目根」的兜底", function () {
    const plan = buildOpenPlan(null);
    assert.equal(plan.ok, false);
    assert.equal(plan.code, NO_PROJECT_ROOT_CODE);
    // 兜底文案要跟入口层一致：说明这次对话没有工作区，不换个入口重试
    assert.equal(plan.message, NO_PROJECT_ROOT_MESSAGE);
    assert.match(plan.message, /没有工作区/);
  });

  it("相对路径也当没有目录", function () {
    const plan = buildOpenPlan("relative/dir");
    assert.equal(plan.ok, false);
    assert.equal(plan.code, NO_PROJECT_ROOT_CODE);
  });

  it("macOS 合法目录先 open 再 code", function () {
    const plan = buildOpenPlan("/tmp/demo", { platform: "darwin" });
    assert.equal(plan.ok, true);
    assert.equal(plan.uri, "vscode://file/tmp/demo");
    assert.equal(plan.spawn[0].command, "/usr/bin/open");
    assert.equal(plan.spawn[1].command, "code");
  });

  it("Windows 用已定位的 Code.exe，不调用 open，也不调用无扩展名的 code", function () {
    const exe = "D:\\Microsoft VS Code\\Code.exe";
    const plan = buildOpenPlan("C:\\work\\app", {
      platform: "win32",
      windowsCommand: exe,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.spawn[0].command, exe);
    assert.equal(plan.spawn[0].args[0], "C:\\work\\app");
    // 直接拉图形界面程序时要清掉 Electron 的 Node 标记
    assert.equal(plan.spawn[0].clearElectronRunAsNode, true);
    assert.equal(plan.spawn[1].command, "code.cmd");
    assert.equal(plan.spawn[1].clearElectronRunAsNode, false);
    assert.equal(plan.spawn.some(function (step) { return step.command === "code"; }), false);
    assert.equal(plan.spawn.some(function (step) { return step.command === "/usr/bin/open"; }), false);
  });

  it("Windows 没定位到安装目录时只试 code.cmd", function () {
    const plan = buildOpenPlan("C:\\work\\app", { platform: "win32" });
    assert.equal(plan.spawn.length, 1);
    assert.equal(plan.spawn[0].command, "code.cmd");
  });
});

describe("locateWindowsCode", function () {
  it("PATH 里有 code.cmd 时用上一级 Code.exe，忽略无扩展名脚本", function () {
    const bin = "D:\\Microsoft VS Code\\bin";
    const exe = path.win32.normalize(path.win32.join(bin, "..", "Code.exe"));
    const cmd = path.win32.join(bin, "code.cmd");
    const script = path.win32.join(bin, "code");
    const exists = function (filePath) {
      return filePath === exe || filePath === cmd || filePath === script;
    };
    const found = locateWindowsCode({ PATH: bin + ";C:\\Windows" }, exists, []);
    assert.equal(found, exe);
  });

  it("只有 code.cmd、没有 Code.exe 时返回脚本本身", function () {
    const bin = "D:\\Microsoft VS Code\\bin";
    const cmd = path.win32.join(bin, "code.cmd");
    const exists = function (filePath) {
      return filePath === cmd;
    };
    assert.equal(locateWindowsCode({ PATH: bin }, exists, []), cmd);
  });

  it("PATH 里只有无扩展名 code 时不当成已安装", function () {
    const bin = "D:\\Microsoft VS Code\\bin";
    const script = path.win32.join(bin, "code");
    const exists = function (filePath) {
      return filePath === script;
    };
    assert.equal(locateWindowsCode({ PATH: bin }, exists, []), null);
  });

  it("PATH 没有时用 LocalAppData 默认安装目录", function () {
    const exe = path.win32.join("C:\\Users\\me\\AppData\\Local", "Programs", "Microsoft VS Code", "Code.exe");
    const exists = function (filePath) {
      return filePath === exe;
    };
    const found = locateWindowsCode({
      PATH: "",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    }, exists, []);
    assert.equal(found, exe);
  });

  it("自定义目录从注册表协议命令里取出，且文件必须存在", function () {
    const exe = "D:\\Microsoft VS Code\\Code.exe";
    const output = "    (Default)    REG_SZ    \"" + exe + "\" --open-url -- \"%1\"\r\n";
    const exists = function (filePath) {
      return filePath === exe;
    };
    assert.equal(parseRegCodePath(output), exe);
    assert.equal(locateWindowsCode({ PATH: "" }, exists, ["", output]), exe);
    // 注册表还留着、文件已经删掉时不能把失效路径交给 spawn
    const missing = function () {
      return false;
    };
    assert.equal(locateWindowsCode({ PATH: "" }, missing, [output]), null);
  });
});

describe("readWorkspacePath", function () {
  it("没有工作区对象返回 null", async function () {
    const path = await readWorkspacePath({
      get: async function () {
        return null;
      },
    });
    assert.equal(path, null);
  });

  it("读出宿主给的 path", async function () {
    const path = await readWorkspacePath({
      get: async function () {
        return { path: "/tmp/demo" };
      },
    });
    assert.equal(path, "/tmp/demo");
  });
});

describe("open-result", function () {
  it("成功和失败形状固定", function () {
    assert.deepEqual(okResult("/tmp/demo", "uri"), {
      ok: true,
      dir: "/tmp/demo",
      method: "uri",
    });
    assert.deepEqual(failResult(NO_PROJECT_ROOT_CODE, "没有项目根"), {
      ok: false,
      code: "NO_PROJECT_ROOT",
      message: "没有项目根",
    });
  });
});
