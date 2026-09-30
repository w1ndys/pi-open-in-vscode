/**
 * 入口层：PI-Desktop 插件主进程。
 * 面板按钮和命令都走到这里，再调数据层和业务层打开 VSCode。
 */

const { spawn } = require("node:child_process");
const { okResult, failResult } = require("./entity/open-result");
const { readWorkspacePath } = require("./data/workspace");
const { buildOpenPlan } = require("./business/open-in-vscode");

/**
 * 等子进程退出，非 0 或 spawn 失败都当成没打开。
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runCommand(command, args) {
  return new Promise(function (resolve, reject) {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", function (error) {
      reject(error);
    });
    child.on("close", function (code) {
      // 退出码不是 0 说明本机没打开 VSCode
      if (code !== 0) {
        reject(new Error(command + " exited " + String(code)));
        return;
      }
      resolve();
    });
  });
}

/**
 * 按计划依次尝试：协议 URI、code、macOS open。
 * @param {{ ok: true, dir: string, uri: string, spawn: Array<{ command: string, args: string[] }> }} plan
 */
async function executeOpenPlan(plan) {
  try {
    await pi.shell.openExternal(plan.uri);
    return okResult(plan.dir, "uri");
  } catch (_error) {
    // vscode:// 没人接就改用本机命令
  }

  let index = 0;
  while (index < plan.spawn.length) {
    const step = plan.spawn[index];
    try {
      await runCommand(step.command, step.args);
      // code 命令成功
      if (step.command === "code") {
        return okResult(plan.dir, "code");
      }
      return okResult(plan.dir, "open");
    } catch (_error) {
      // 这一步失败就试下一步
    }
    index += 1;
  }

  return failResult("OPEN_FAILED", "打不开 VSCode。请确认已安装，并在 VSCode 里装过 code 命令。");
}

/**
 * 读当前工作目录并打开。
 */
async function openCurrentWorkspace() {
  const dir = await readWorkspacePath(pi.workspace);
  const plan = buildOpenPlan(dir);
  // 业务层已经判定没有目录
  if (!plan.ok) {
    return failResult(plan.code, plan.message);
  }
  return executeOpenPlan(plan);
}

/**
 * 面板自定义通道。
 */
async function onPanelInvoke(channel, _payload) {
  // 只认打开这一条通道
  if (channel !== "open.current") {
    return failResult("UNSUPPORTED", "unknown channel: " + channel);
  }
  try {
    return await openCurrentWorkspace();
  } catch (error) {
    return failResult("OPEN_FAILED", String(error && error.message ? error.message : error));
  }
}

/**
 * 插件加载：把命令面板入口挂上。
 */
async function onLoad() {
  await pi.commands.register({
    id: "open-in-vscode.open",
    title: "用 VSCode 打开当前工作目录",
    run: async function () {
      const result = await openCurrentWorkspace();
      // 失败时用 toast 告诉用户原因
      if (!result.ok) {
        await pi.ui.showToast(result.message);
        return;
      }
      await pi.ui.showToast("已用 VSCode 打开");
    },
  });
}

/**
 * 插件卸载：摘掉命令。
 */
async function onUnload() {
  await pi.commands.unregister("open-in-vscode.open");
}

module.exports = { onLoad, onUnload, onPanelInvoke };
