/**
 * 入口层：PI-Desktop 插件主进程。
 * 两条入口——输入框按钮与右下角角落按钮——都走到这里，
 * 再调数据层和业务层打开 VSCode；斜杠命令走同一条路径。
 */

const { spawn } = require("node:child_process");
const { okResult, failResult } = require("./entity/open-result");
const { readWorkspacePath } = require("./data/workspace");
const { buildOpenPlan } = require("./business/pi-open-in-vscode");

/** 输入框按钮与角落按钮共用的方法名，必须与 manifest.rendererCallMethods 一致。 */
const OPEN_ACTION = "openWorkspace";

/** 命令 id 与标题。斜杠与命令面板共用同一个 id。 */
const COMMAND_ID = "vscode";
const COMMAND_TITLE = "用 VSCode 打开当前工作目录";

/** 成功提示。所有入口共用同一句话。 */
const SUCCESS_MESSAGE = "已用 VSCode 打开";

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
 * @param {Function} [runner] 测试注入的执行器，默认真拉起命令
 */
async function executeOpenPlan(plan, runner) {
  const start = runner || runCommand;
  let index = 0;
  while (index < plan.spawn.length) {
    const step = plan.spawn[index];
    try {
      await start(step.command, step.args);
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
 * @param {Function} [runner] 测试注入的执行器
 */
async function openCurrentWorkspace(runner) {
  const dir = await readWorkspacePath(pi.workspace);
  const plan = buildOpenPlan(dir);
  // 业务层已经判定没有目录
  if (!plan.ok) {
    return failResult(plan.code, plan.message);
  }
  return executeOpenPlan(plan, runner);
}

/**
 * 打开并提示。所有入口共用，保证行为和文案不会各走一套。
 * @param {Function} [runner] 测试注入的执行器
 */
async function openAndAnnounce(runner) {
  const result = await openCurrentWorkspace(runner);
  // 失败时用 toast 说明原因
  if (!result.ok) {
    await pi.ui.showToast(result.message);
    return result;
  }
  await pi.ui.showToast(SUCCESS_MESSAGE);
  return result;
}

/**
 * 按钮入口的调用：只认一个方法，不认识的直接拒绝，不猜意图。
 * @param {unknown} method manifest.rendererCallMethods 里的方法名
 * @param {unknown} args 按钮不传参数
 * @param {Function} [runner] 测试注入的执行器
 */
async function onRendererCall(method, args, runner) {
  // 不认识的方法直接拒绝
  if (method !== OPEN_ACTION) {
    return failResult("UNKNOWN_METHOD", "不支持的操作。");
  }
  return openAndAnnounce(runner);
}

/**
 * 插件加载：挂上立刻打开的命令。
 * 界面按钮由 renderer/index.mjs 注册（输入框按钮 + 角落按钮）。
 */
async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: COMMAND_TITLE,
    run: async function () {
      await openAndAnnounce();
    },
  });
}

/**
 * 插件卸载：摘掉命令。
 */
async function onUnload() {
  await pi.commands.unregister(COMMAND_ID);
}

module.exports = {
  onLoad,
  onUnload,
  onRendererCall,
  openCurrentWorkspace,
  openAndAnnounce,
  executeOpenPlan,
  COMMAND_ID,
  COMMAND_TITLE,
  SUCCESS_MESSAGE,
  OPEN_ACTION,
};
