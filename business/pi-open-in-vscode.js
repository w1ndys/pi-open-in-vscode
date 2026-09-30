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
      code: "NO_WORKSPACE",
      message: "当前没有工作目录，先打开一个项目。",
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

module.exports = { isAbsoluteDir, vscodeFileUri, buildOpenPlan };
