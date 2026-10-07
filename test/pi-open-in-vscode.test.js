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

  it("合法目录先 open 再 code", function () {
    const plan = buildOpenPlan("/tmp/demo");
    assert.equal(plan.ok, true);
    assert.equal(plan.uri, "vscode://file/tmp/demo");
    assert.equal(plan.spawn[0].command, "/usr/bin/open");
    assert.equal(plan.spawn[1].command, "code");
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
