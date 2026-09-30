/**
 * 入口层：PI-Desktop 插件主进程。
 * 面板按钮和命令都走到这里，再调数据层和业务层打开 VSCode。
 */

const { spawn } = require("node:child_process");
const { okResult, failResult } = require("./entity/open-result");
const { readWorkspacePath } = require("./data/workspace");
const { buildOpenPlan } = require("./business/pi-open-in-vscode");

/**
 * 拉起命令后立刻返回，不等 VSCode 退出，也不走会弹确认的协议。
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runCommand(command, args) {
  return new Promise(function (resolve, reject) {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    let settled = false;
    child.once("error", function (error) {
      // 命令不存在或没法启动
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    child.once("spawn", function () {
      // 进程已经起来，后台打开即可
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve();
    });
  });
}

/**
 * 按计划依次尝试本机命令，点一下就打开。
 * @param {{ ok: true, dir: string, spawn: Array<{ command: string, args: string[] }> }} plan
 */
async function executeOpenPlan(plan) {
  let index = 0;
  while (index < plan.spawn.length) {
    const step = plan.spawn[index];
    try {
      await runCommand(step.command, step.args);
      // macOS open -a 成功
      if (step.command === "/usr/bin/open") {
        return okResult(plan.dir, "open");
      }
      return okResult(plan.dir, "code");
    } catch (_error) {
      // 这一步失败就试下一步
    }
    index += 1;
  }

  return failResult("OPEN_FAILED", "打不开 VSCode。请确认已安装 Visual Studio Code。");
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
  if (channel !== "pi-open-in-vscode.open") {
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
    id: "pi-open-in-vscode.open",
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
  await pi.commands.unregister("pi-open-in-vscode.open");
}

module.exports = { onLoad, onUnload, onPanelInvoke };
