/**
 * 业务层：根据工作目录算出怎么打开 VSCode。
 * 不真正执行命令，方便单测。
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
 * 根据目录生成打开计划：只走本机命令，不弹 vscode:// 确认框。
 * 插件进程往往没有用户 PATH，所以先 open -a，再试 code。
 * @param {unknown} dir
 */
function buildOpenPlan(dir) {
  // 没有合法绝对路径就不能打开，避免 spawn 相对路径
  if (!isAbsoluteDir(dir)) {
    return {
      ok: false,
      code: NO_PROJECT_ROOT_CODE,
      message: NO_PROJECT_ROOT_MESSAGE,
    };
  }
  return {
    ok: true,
    dir: dir,
    uri: vscodeFileUri(dir),
    spawn: [
      { command: "/usr/bin/open", args: ["-a", "Visual Studio Code", dir] },
      { command: "code", args: [dir] },
    ],
  };
}

module.exports = {
  isAbsoluteDir,
  vscodeFileUri,
  buildOpenPlan,
  NO_PROJECT_ROOT_CODE,
  NO_PROJECT_ROOT_MESSAGE,
};
