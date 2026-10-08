/**
 * 业务层：根据工作目录算出怎么打开 VSCode。
 * 不真正执行命令，也不查磁盘，方便单测。
 */

/**
 * 判断是不是可交给 VSCode 的绝对目录。
 * @param {unknown} dir
 * @returns {boolean}
 */
function isAbsoluteDir(dir) {
  // 空值或非字符串不能当目录
  if (typeof dir !== "string" || dir.trim() === "") {
    return false;
  }
  // POSIX 绝对路径
  if (dir.startsWith("/")) {
    return true;
  }
  // Windows 盘符路径
  if (/^[A-Za-z]:[\\/]/.test(dir)) {
    return true;
  }
  return false;
}

/**
 * 把绝对目录编成 vscode://file URI。
 * @param {string} dir
 * @returns {string}
 */
function vscodeFileUri(dir) {
  const normalized = dir.replace(/\\/g, "/");
  // Windows 盘符要补一个根斜杠，否则协议解析会丢盘符
  if (/^[A-Za-z]:\//.test(normalized)) {
    return "vscode://file/" + normalized;
  }
  return "vscode://file" + normalized;
}

/** 「本次对话没有工作区」的稳定错误码，入口层与渲染器都认它。 */
const NO_PROJECT_ROOT_CODE = "NO_PROJECT_ROOT";

/** 没有工作区时给用户看的一句话；两个按钮不会出现，只有 /vscode 命令看得到它。 */
const NO_PROJECT_ROOT_MESSAGE = "本次对话没有工作区（临时会话），宿主没有把会话目录给插件，打不开。";

/**
 * 是不是 Windows 的 code.cmd。绝对路径和单独的命令名都算。
 * @param {unknown} command
 * @returns {boolean}
 */
function isCodeCmd(command) {
  // 不是字符串就不可能是启动脚本
  if (typeof command !== "string") {
    return false;
  }
  return command.toLowerCase().endsWith("code.cmd");
}

/**
 * 一条 Windows 启动步骤。
 * 直接拉 Code.exe 时要清掉 Electron 的「当 Node 跑」标记，否则窗口不会出现。
 * code.cmd 会自己设置这个变量再转给 CLI，外面不要替它清。
 * @param {string} command
 * @param {string} dir
 */
function windowsStep(command, dir) {
  const isExe = command.toLowerCase().endsWith("code.exe");
  return {
    command: command,
    args: [dir],
    windowsHide: true,
    // 只有直接拉起图形界面程序才清环境
    clearElectronRunAsNode: isExe,
  };
}

/**
 * Windows 上的启动步骤。
 * 不能 spawn 名为 code 的命令：安装目录里同名无扩展名文件是 shell 脚本，Node 会先命中它然后失败。
 * @param {string} dir
 * @param {string | null | undefined} windowsCommand 已经定位到的 Code.exe 或 code.cmd
 */
function windowsSpawnSteps(dir, windowsCommand) {
  const steps = [];
  // 定位到了就先用绝对路径，不依赖进程 PATH，也不会撞上无扩展名脚本
  if (typeof windowsCommand === "string" && windowsCommand.trim() !== "") {
    steps.push(windowsStep(windowsCommand, dir));
  }
  // 还没试过 code.cmd 时留一条退路；已经是 code.cmd 就不再重复试一次
  if (!isCodeCmd(windowsCommand)) {
    steps.push({
      command: "code.cmd",
      args: [dir],
      windowsHide: true,
      clearElectronRunAsNode: false,
    });
  }
  return steps;
}

/**
 * macOS 的启动步骤。open -a 不依赖 PATH，失败再试 code。
 * @param {string} dir
 */
function macSpawnSteps(dir) {
  return [
    { command: "/usr/bin/open", args: ["-a", "Visual Studio Code", dir] },
    { command: "code", args: [dir] },
  ];
}

/**
 * 调用方没说明系统时按当前进程来。测试会显式传入，避免换一台机器结果就变。
 * @param {{ platform?: string } | undefined} launch
 * @returns {string}
 */
function launchPlatform(launch) {
  // 缺省按当前进程，插件主进程会传入真实系统
  if (!launch || typeof launch.platform !== "string" || launch.platform === "") {
    return process.platform;
  }
  return launch.platform;
}

/**
 * 根据目录生成打开计划：只走本机命令，不弹 vscode:// 确认框。
 * @param {unknown} dir
 * @param {{ platform?: string, windowsCommand?: string | null }} [launch]
 */
function buildOpenPlan(dir, launch) {
  // 没有合法绝对路径就不能打开，避免 spawn 相对路径
  if (!isAbsoluteDir(dir)) {
    return {
      ok: false,
      code: NO_PROJECT_ROOT_CODE,
      message: NO_PROJECT_ROOT_MESSAGE,
    };
  }
  const platform = launchPlatform(launch);
  // Windows 没有 open -a，也不能 spawn 无扩展名的 code
  if (platform === "win32") {
    const windowsCommand = launch && launch.windowsCommand;
    return {
      ok: true,
      dir: dir,
      uri: vscodeFileUri(dir),
      spawn: windowsSpawnSteps(dir, windowsCommand),
    };
  }
  return {
    ok: true,
    dir: dir,
    uri: vscodeFileUri(dir),
    spawn: macSpawnSteps(dir),
  };
}

module.exports = {
  isAbsoluteDir,
  vscodeFileUri,
  buildOpenPlan,
  NO_PROJECT_ROOT_CODE,
  NO_PROJECT_ROOT_MESSAGE,
};
