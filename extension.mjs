/**
 * Agent 扩展：在「这次会话的工作目录」里打开 VS Code。
 *
 * 插件 API 拿不到当前会话的工作目录。扩展的 cwd 也不是会话 scratch：
 * 宿主实现是 `projectPath ?? process.cwd()`（sidecar.js createExtensionBridge）。
 * 临时会话没有项目根，于是 cwd 退回 sidecar 进程目录（实测是 /）。
 * 模型的 bash 能看到 scratch，是因为工具工作区由 host-core 另解析，不走这条 cwd。
 *
 * 所以：项目会话打开项目根；cwd 是 /、. 或空时取消，避免打开系统根目录。
 *
 * 这个模块只做一件事：跑一条写死的命令。
 * 不接用户输入的命令、不接网络、不读写文件、不碰凭证。
 */

/** 注册到全局搜索与输入框的命令名，输入框里敲 /vscode-here。 */
export const COMMAND_NAME = "vscode-here";

/** 命令在界面上的一句话说明。 */
export const COMMAND_DESCRIPTION = "在宿主给的目录里打开 VS Code（临时会话宿主不给目录时会取消）";

/** 首选方式：macOS 的 open -a，不依赖 PATH。 */
const OPEN_COMMAND = "/usr/bin/open";

/** `open` 的参数前缀，目录由调用处追加。 */
const OPEN_ARGS = ["-a", "Visual Studio Code"];

/** 兜底方式：PATH 上有 code 命令时用它。 */
const FALLBACK_COMMAND = "code";


/**
 * 定出要打开的目录。
 * 宿主给扩展的 cwd 是项目根，没有就退回 sidecar 进程目录。
 * 临时会话因此会拿到 / 或空，这两种都不能打开。
 * @param {unknown} context 扩展上下文
 * @returns {string | null}
 */
export function resolveDirectory(context) {
  const cwd = context && typeof context === "object" ? context.cwd : null;
  // 空值说明宿主没给目录
  if (typeof cwd !== "string" || cwd.trim() === "") {
    return null;
  }
  const dir = cwd.trim();
  // / 与 . 是进程目录的退路，不是本次对话的工作目录
  if (dir === "/" || dir === "." || dir === "\\") {
    return null;
  }
  return dir;
}

/**
 * 按顺序试本机命令，成功一个就返回。
 * @param {object} pi 扩展 API
 * @param {string} dir 目标目录
 * @returns {Promise<{ ok: boolean, dir: string, method?: string, message?: string }>}
 */
export async function openInVscode(pi, dir) {
  const attempts = [
    { method: "open", command: OPEN_COMMAND, args: OPEN_ARGS.concat([dir]) },
    { method: "code", command: FALLBACK_COMMAND, args: [dir] },
  ];
  let index = 0;
  while (index < attempts.length) {
    const attempt = attempts[index];
    try {
      await pi.exec(attempt.command, attempt.args);
      return { ok: true, dir: dir, method: attempt.method };
    } catch (_error) {
      // 这一步失败就试下一步
    }
    index += 1;
  }
  return {
    ok: false,
    dir: dir,
    message: "打不开 VSCode。请确认已安装 Visual Studio Code，或把 code 命令放进 PATH。",
  };
}

/** 宿主没给可信目录时给用户看的一句话。 */
export const NO_SESSION_DIR_MESSAGE = "宿主没把本次对话的工作目录给扩展（临时会话会退回系统根目录 /），已取消打开。";

/**
 * 命令处理：打开目录，失败时用通知说明原因。
 * @param {object} pi 扩展 API
 * @param {unknown} context 扩展上下文
 * @returns {Promise<object>} 结果，供测试断言
 */
export async function runOpenHere(pi, context) {
  const dir = resolveDirectory(context);
  // 没有可信目录就别 spawn，避免打开系统根目录
  if (dir === null) {
    if (context && context.ui && typeof context.ui.notify === "function") {
      await context.ui.notify(NO_SESSION_DIR_MESSAGE, "error");
    }
    return { ok: false, dir: null, message: NO_SESSION_DIR_MESSAGE };
  }
  const result = await openInVscode(pi, dir);
  // 失败要说一声，别静默什么都不发生
  if (!result.ok && context && context.ui && typeof context.ui.notify === "function") {
    await context.ui.notify(result.message, "error");
  }
  return result;
}

/**
 * 扩展入口：宿主加载模块后调用它，并传入扩展 API。
 * @param {object} pi 扩展 API
 */
export default function openInVscodeExtension(pi) {
  pi.registerCommand(COMMAND_NAME, {
    description: COMMAND_DESCRIPTION,
    handler: async function (_input, context) {
      await runOpenHere(pi, context);
    },
  });
}
