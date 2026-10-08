/**
 * 数据层：在 Windows 上找出 VS Code 的启动文件。
 * 不启动编辑器，只返回 Code.exe 或 code.cmd 的路径；找不到返回 null。
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** 安装器放进 PATH 的 Windows 启动脚本。必须带 .cmd，不能用无扩展名的 code。 */
const CODE_CMD_NAME = "code.cmd";

/** 安装目录根上的图形界面程序。直接启动它，就不必再套一层 cmd。 */
const CODE_EXE_NAME = "Code.exe";

/**
 * 把 PATH 拆成目录列表。
 * @param {unknown} pathEnv
 * @returns {string[]}
 */
function splitPath(pathEnv) {
  // 没有 PATH 时不要猜当前目录，否则会把插件自己的目录当成安装位置
  if (typeof pathEnv !== "string" || pathEnv.trim() === "") {
    return [];
  }
  const parts = pathEnv.split(";");
  const dirs = [];
  let index = 0;
  while (index < parts.length) {
    const dir = parts[index].trim();
    index += 1;
    // 开头或连续分号会产生空段，空段表示当前目录，不能拿来找编辑器
    if (dir === "") {
      continue;
    }
    dirs.push(dir);
  }
  return dirs;
}

/**
 * 只接受 VS Code 自己的两个启动文件。
 * 注册表里的协议命令后面还跟着参数，不能把别的程序也拿来执行。
 * @param {string} filePath
 * @returns {boolean}
 */
function isCodeLauncher(filePath) {
  const lower = filePath.toLowerCase();
  // 图形界面程序
  if (lower.endsWith("\\code.exe") || lower.endsWith("/code.exe")) {
    return true;
  }
  // Windows 批处理启动脚本
  if (lower.endsWith("\\code.cmd") || lower.endsWith("/code.cmd")) {
    return true;
  }
  return false;
}

/**
 * bin 目录里有 code.cmd 时，优先返回上一级的 Code.exe。
 * 同目录那个没有扩展名的 code 是 shell 脚本，这里不看它。
 * @param {string} binDir
 * @param {(filePath: string) => boolean} exists
 * @returns {string | null}
 */
function launcherBesideCmd(binDir, exists) {
  const cmdPath = path.win32.join(binDir, CODE_CMD_NAME);
  // 没有 code.cmd 就不是 VS Code 的 bin；无扩展名的 code 不能拿来启动
  if (!exists(cmdPath)) {
    return null;
  }
  const exePath = path.win32.normalize(path.win32.join(binDir, "..", CODE_EXE_NAME));
  // 有图形界面程序就直接用它，避免 cmd 转一层，也避免路径里的空格被拆开
  if (exists(exePath) && isCodeLauncher(exePath)) {
    return exePath;
  }
  // 只有脚本时退回脚本本身，至少不会撞上无扩展名文件
  if (isCodeLauncher(cmdPath)) {
    return cmdPath;
  }
  return null;
}

/**
 * 沿 PATH 找 VS Code。命中第一个就停，和终端里 where 的顺序一致。
 * @param {unknown} pathEnv
 * @param {(filePath: string) => boolean} exists
 * @returns {string | null}
 */
function findOnPath(pathEnv, exists) {
  const dirs = splitPath(pathEnv);
  let index = 0;
  while (index < dirs.length) {
    const found = launcherBesideCmd(dirs[index], exists);
    index += 1;
    // 用 PATH 里靠前的那一份，后面的旧安装不覆盖它
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * 安装器的默认目录。自定义盘符装不到这里，只作 PATH 没有时的补充。
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function fixedInstallPaths(env) {
  const paths = [];
  // 用户安装默认在 LocalAppData，不写注册表也能找到
  if (typeof env.LOCALAPPDATA === "string" && env.LOCALAPPDATA !== "") {
    paths.push(path.win32.join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code", CODE_EXE_NAME));
  }
  // 系统安装默认在 Program Files
  if (typeof env.ProgramFiles === "string" && env.ProgramFiles !== "") {
    paths.push(path.win32.join(env.ProgramFiles, "Microsoft VS Code", CODE_EXE_NAME));
  }
  const programFilesX86 = env["ProgramFiles(x86)"];
  // 32 位安装目录，64 位机器上偶尔还有
  if (typeof programFilesX86 === "string" && programFilesX86 !== "") {
    paths.push(path.win32.join(programFilesX86, "Microsoft VS Code", CODE_EXE_NAME));
  }
  return paths;
}

/**
 * 返回第一个真实存在、且名字符合要求的启动文件。
 * @param {string[]} candidates
 * @param {(filePath: string) => boolean} exists
 * @returns {string | null}
 */
function firstExisting(candidates, exists) {
  let index = 0;
  while (index < candidates.length) {
    const candidate = candidates[index];
    index += 1;
    // 目录不存在就看下一个，不把不存在的路径交给 spawn
    if (exists(candidate) && isCodeLauncher(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 从 reg query 的一行里取出值。
 * 先认 REG_EXPAND_SZ，因为它里面就包含 REG_SZ 这几个字。
 * @param {string} line
 * @returns {string | null}
 */
function valueAfterType(line) {
  const types = ["REG_EXPAND_SZ", "REG_SZ"];
  let index = 0;
  while (index < types.length) {
    const typeName = types[index];
    const at = line.indexOf(typeName);
    index += 1;
    // 这一行不是这个类型，看下一个类型名
    if (at === -1) {
      continue;
    }
    return line.slice(at + typeName.length).trim();
  }
  return null;
}

/**
 * 从注册表默认值里抽出可执行文件路径。
 * 协议命令带引号，App Paths 常常不带引号。
 * @param {string} value
 * @returns {string | null}
 */
function extractExePath(value) {
  // 带引号时，引号内才是程序路径，后面的 --open-url 不能算进去
  if (value.startsWith("\"")) {
    const end = value.indexOf("\"", 1);
    // 只有开头引号、没有结尾引号，不能猜路径切到哪里
    if (end <= 1) {
      return null;
    }
    return value.slice(1, end);
  }
  const lower = value.toLowerCase();
  const end = lower.indexOf(".exe");
  // 没有 .exe 就不是可执行文件路径
  if (end === -1) {
    return null;
  }
  return value.slice(0, end + 4);
}

/**
 * 解析 reg query 的标准输出，取出 Code.exe。
 * @param {string} output
 * @returns {string | null}
 */
function parseRegCodePath(output) {
  const lines = output.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const value = valueAfterType(lines[index]);
    index += 1;
    // 键名那一行没有类型字段，跳过
    if (value === null) {
      continue;
    }
    const exePath = extractExePath(value);
    // 这一行不是 Code.exe，继续看后面的值
    if (exePath === null || !isCodeLauncher(exePath)) {
      continue;
    }
    return exePath;
  }
  return null;
}

/**
 * 安装器会写的注册表位置。
 * 自定义目录（例如 D:\Microsoft VS Code）靠这里，不靠写死的盘符。
 * @returns {string[]}
 */
function registryKeys() {
  return [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe",
    "HKCU\\Software\\Classes\\vscode\\shell\\open\\command",
    "HKLM\\Software\\Classes\\vscode\\shell\\open\\command",
    "HKLM\\SOFTWARE\\Classes\\vscode\\shell\\open\\command",
  ];
}

/**
 * 从一批 reg query 输出里找第一个 Code.exe。
 * @param {string[]} outputs
 * @returns {string | null}
 */
function findInRegistryOutputs(outputs) {
  let index = 0;
  while (index < outputs.length) {
    const output = outputs[index];
    index += 1;
    // 查询失败时调用方给空串，不当成路径
    if (typeof output !== "string" || output.trim() === "") {
      continue;
    }
    const found = parseRegCodePath(output);
    // 这一处没有 Code.exe，看下一个键
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * 按 PATH、默认安装目录、注册表的顺序找启动文件。
 * @param {NodeJS.ProcessEnv} env
 * @param {(filePath: string) => boolean} exists
 * @param {string[]} registryOutputs reg query 的标准输出，失败的项用空串
 * @returns {string | null}
 */
function locateWindowsCode(env, exists, registryOutputs) {
  const onPath = findOnPath(env.PATH, exists);
  // PATH 里已有安装目录时用它，和用户在终端里用的是同一份
  if (onPath) {
    return onPath;
  }
  const fixed = firstExisting(fixedInstallPaths(env), exists);
  // 默认目录覆盖「没把 bin 加进 PATH」的用户安装和系统安装
  if (fixed) {
    return fixed;
  }
  const outputs = registryOutputs || [];
  const fromReg = findInRegistryOutputs(outputs);
  // 注册表能覆盖自定义安装目录；文件不在就不当真，避免 spawn 一个已卸载的路径
  if (fromReg && exists(fromReg)) {
    return fromReg;
  }
  return null;
}

/**
 * 查询一个注册表键的默认值。失败返回空串，不抛错。
 * @param {string} key
 * @returns {string}
 */
function queryRegistryDefault(key) {
  const root = process.env.SystemRoot;
  let regExe = "reg.exe";
  // 用 System32 里的 reg，避免 PATH 被改过时找不到查询工具
  if (typeof root === "string" && root !== "") {
    regExe = path.win32.join(root, "System32", "reg.exe");
  }
  const result = spawnSync(regExe, ["query", key, "/ve"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  // 键不存在或 reg 失败都当没装在这个位置
  if (!result || result.status !== 0 || typeof result.stdout !== "string") {
    return "";
  }
  return result.stdout;
}

/**
 * 读完所有候选注册表键。只应在 Windows 上调用。
 * @returns {string[]}
 */
function readRegistryDefaults() {
  const keys = registryKeys();
  const outputs = [];
  let index = 0;
  while (index < keys.length) {
    outputs.push(queryRegistryDefault(keys[index]));
    index += 1;
  }
  return outputs;
}

module.exports = {
  locateWindowsCode,
  readRegistryDefaults,
  parseRegCodePath,
  splitPath,
};
