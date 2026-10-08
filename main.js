/**
 * 入口层：PI-Desktop 插件主进程。
 * 只有一条命令（斜杠命令 /vscode 与命令面板），加上界面上的两个按钮，
 * 都走到这里：目录只读一次当前项目根。
 * 按钮显示前先问一次 hasWorkspace——没有工作区的会话里插件整个不出现。
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { okResult, failResult } = require("./entity/open-result");
const { readWorkspacePath } = require("./data/workspace");
const { locateWindowsCode, readRegistryDefaults } = require("./data/vscode-install");
const {
  buildOpenPlan,
  NO_PROJECT_ROOT_CODE,
  NO_PROJECT_ROOT_MESSAGE,
} = require("./business/pi-open-in-vscode");

/**
 * 定出这次要打开的目录。
 * 只认当前打开项目的根：读不到就返回 null，不去猜临时会话的目录。
 * @returns {Promise<string | null>}
 */
async function resolveOpenDir() {
  return readWorkspacePath(pi.workspace);
}

/**
 * 按钮显示前的探测：这次对话有没有工作区。
 * 单独一条方法，免得为了显示按钮先打开一次；探测不了就当没有。
 * @returns {Promise<{ ok: true, hasWorkspace: boolean }>}
 */
async function probeWorkspace() {
  let dir = null;
  try {
    dir = await resolveOpenDir();
  } catch (_error) {
    // 读不到工作区就当没有：宁可按钮不出现，也不能猜一个目录出来
    dir = null;
  }
  return { ok: true, hasWorkspace: dir !== null };
}

/** 命令 id 与标题。斜杠与命令面板共用同一个 id。 */
const COMMAND_ID = "vscode";
const COMMAND_TITLE = "用 VSCode 打开当前工作目录";

/** 角落按钮用的方法名，必须与 manifest.rendererCallMethods 一致。 */
const OPEN_ACTION = "openWorkspace";

/** 按钮显示前的探测方法名；同样要出现在 manifest.rendererCallMethods 里。 */
const PROBE_ACTION = "hasWorkspace";

/** 成功提示。所有入口共用同一句话。 */
const SUCCESS_MESSAGE = "已用 VSCode 打开";

/**
 * 直接启动 Code.exe 时用的环境。
 * 去掉「把 Electron 当 Node 跑」的变量，否则编辑器进程会秒退、窗口不出现。
 * @returns {NodeJS.ProcessEnv}
 */
function envForCodeExe() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
  return env;
}

/**
 * 拉起命令后立刻返回，不等 VSCode 退出，也不走会弹确认的协议。
 * @param {string} command
 * @param {string[]} args
 * @param {{ clearElectronRunAsNode?: boolean }} [step]
 * @returns {Promise<void>}
 */
function runCommand(command, args, step) {
  return new Promise(function (resolve, reject) {
    const spawnOptions = {
      stdio: "ignore",
      detached: true,
      // Windows 拉起脚本时不闪控制台；其它系统忽略这项
      windowsHide: true,
    };
    // 只有直接拉 Code.exe 才换环境；code.cmd 要自己设置这个变量再转给 CLI
    if (step && step.clearElectronRunAsNode) {
      spawnOptions.env = envForCodeExe();
    }
    const child = spawn(command, args, spawnOptions);
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
 * 查 Windows 安装路径。查失败就返回 null，交给计划里的 code.cmd 退路。
 * @returns {string | null}
 */
function safeLocateWindowsCode() {
  try {
    const withoutRegistry = locateWindowsCode(process.env, fs.existsSync, []);
    // PATH 或默认安装目录已经能确定时，不必再启动 reg.exe
    if (withoutRegistry) {
      return withoutRegistry;
    }
    return locateWindowsCode(process.env, fs.existsSync, readRegistryDefaults());
  } catch (_error) {
    // 注册表或磁盘查询异常时不当成「没装」，后面还有 code.cmd 可试
    return null;
  }
}

/**
 * 这次打开要用的系统信息。Windows 先定位 Code.exe，其它系统仍走 open -a。
 * @returns {{ platform: string, windowsCommand?: string | null }}
 */
function describeLaunch() {
  // 非 Windows 没有 Code.exe 这一层，保持原来的 open -a
  if (process.platform !== "win32") {
    return { platform: process.platform };
  }
  return {
    platform: "win32",
    windowsCommand: safeLocateWindowsCode(),
  };
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
      await start(step.command, step.args, step);
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
 * 定出目录并打开。
 * @param {Function} [runner] 测试注入的执行器
 */
async function openCurrentWorkspace(runner) {
  const dir = await resolveOpenDir();
  // 拿不到项目根说明这是没有工作区的会话：插件不猜目录，界面上也不会画按钮
  if (dir === null) {
    return failResult(NO_PROJECT_ROOT_CODE, NO_PROJECT_ROOT_MESSAGE);
  }
  const plan = buildOpenPlan(dir, describeLaunch());
  // 业务层兜底：目录存在但不是可交给 VSCode 的绝对路径
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
 * 按钮入口的调用：探测与打开各一个方法，不认识的直接拒绝，不猜意图。
 * @param {unknown} method manifest.rendererCallMethods 里的方法名
 * @param {unknown} args 按钮不传参数
 * @param {Function} [runner] 测试注入的执行器
 */
async function onRendererCall(method, args, runner) {
  // 显示按钮前先问有没有工作区，这一条不打开任何东西
  if (method === PROBE_ACTION) {
    return probeWorkspace();
  }
  // 不认识的方法直接拒绝
  if (method !== OPEN_ACTION) {
    return failResult("UNKNOWN_METHOD", "不支持的操作。");
  }
  return openAndAnnounce(runner);
}

/**
 * 插件加载：只挂上立刻打开的命令。
 * 界面按钮由 renderer/index.mjs 自己画（右下角的角落按钮）。
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
  resolveOpenDir,
  probeWorkspace,
  PROBE_ACTION,
  COMMAND_ID,
  COMMAND_TITLE,
  SUCCESS_MESSAGE,
  OPEN_ACTION,
  NO_PROJECT_ROOT_CODE,
  NO_PROJECT_ROOT_MESSAGE,
};
