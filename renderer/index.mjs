/**
 * 渲染器入口：在输入框那一行放一个按钮，并在窗口右下角放一个常驻按钮。
 * 无构建的 ES 模块；react 由宿主窗口的 import map 提供，
 * 角落按钮走自绘层，只用普通 DOM，不依赖 react。
 *
 * 只有有工作区的对话才有按钮：插槽挂上来先问插件一次 hasWorkspace，
 * 没有工作区就什么都不画——临时会话里插件整个不出现，
 * 也就不存在「点一下去打开一个猜出来的目录」。
 *
 * 角落按钮的存活绑在输入框插槽上：插槽只在对话界面渲染，
 * 所以设置页、插件页、定时任务页都不会出现这个按钮。
 * 这也是官方示例 examples/plugins/ui-slots-lab 的 useLayer 写法（挂载开层、卸载关层）。
 */
import { createElement as h, useEffect, useState } from "react";
import { PLUGIN_CSS } from "./styles.mjs";
import { openCornerButton } from "./corner.mjs";

/** 探测「这次对话有没有工作区」的方法名，必须与 manifest.rendererCallMethods 一致。 */
const PROBE_METHOD = "hasWorkspace";

/** 插件侧 onRendererCall 认的打开方法名，必须与 manifest.rendererCallMethods 一致。 */
const CALL_METHOD = "openWorkspace";

/** 三种显示状态：还在探测、有工作区、没有工作区。 */
const STATE_UNKNOWN = "unknown";
const STATE_YES = "yes";
const STATE_NO = "no";

/**
 * 插件侧「本次对话没有工作区」的错误码。
 * 渲染器是浏览器 ESM，require 不了业务层，只能写同一份字面量；
 * 导出出来是为了让测试断言它与业务层的常量一致（防漂移）。
 */
export const NO_PROJECT_ROOT_CODE = "NO_PROJECT_ROOT";

/** 界面自己认的错误码：这次点击发现没有工作区，按钮该消失。 */
export const NO_SESSION_DIR_CODE = "NO_SESSION_DIR";

/** 没有工作区时留给用户的一句话。 */
export const NO_WORKSPACE_MESSAGE = "本次对话没有工作区（临时会话），这个按钮已隐藏。";

/** 当前加载周期的 pi。宿主每次加载都给一个新的。 */
let currentPi = null;

/** 当前打开的角落按钮层。 */
let corner = null;

/** 还挂着的输入框插槽数量。宿主重挂时靠它避免叠出两个按钮。 */
let cornerHolders = 0;

/**
 * 上一次探测到的状态，只当挂载时的起点：插槽每次挂上来都会重新探测一次，
 * 所以换会话之后不会一直用上一个会话的结果。
 */
let workspaceState = STATE_UNKNOWN;

/**
 * 应用语言标签。Electron 里 navigator.language 跟随应用语言。
 * @returns {string}
 */
function currentLanguage() {
  const nav = globalThis.navigator;
  return nav && typeof nav.language === "string" ? nav.language : "en";
}

/**
 * 派发一次打开。两条入口共用这一条路径。
 * @returns {Promise<unknown>}
 */
function invokeOpen() {
  return currentPi.dispatch("plugin.call", { method: CALL_METHOD, args: {} });
}

/**
 * 问一次插件：这次对话有没有工作区。
 * 答案不是 true、或宿主拒绝这次调用，都按「没有」处理——
 * 按钮不出现，比打开一个猜出来的目录安全。
 * @returns {Promise<boolean>}
 */
function probeWorkspace() {
  // 还没加载完就问不了：按没有工作区处理，先不画按钮
  if (!currentPi) {
    return Promise.resolve(false);
  }
  return currentPi.dispatch("plugin.call", { method: PROBE_METHOD, args: {} }).then(
    function (value) {
      // 只有插件明确说有工作区才算有
      return !!value && typeof value === "object" && value.hasWorkspace === true;
    },
    function () {
      // 探测失败：同样按没有工作区处理
      return false;
    }
  );
}

/**
 * 记下这次探测到的状态，供后面重挂的插槽当起点。
 * @param {boolean} hasWorkspace
 * @returns {string} 记下的状态
 */
function rememberWorkspaceState(hasWorkspace) {
  workspaceState = hasWorkspace ? STATE_YES : STATE_NO;
  return workspaceState;
}

/**
 * 两条入口共用的打开流程。
 * 没有工作区时不再猜目录：记下「没有」，收掉角落按钮，
 * 返回一个稳定的错误码，让输入框按钮自己从这一行撤掉。
 * @returns {Promise<unknown>}
 */
export async function runOpen() {
  const value = await invokeOpen();
  // 成功就原样交给界面
  if (value && typeof value === "object" && value.ok === true) {
    return value;
  }
  const code = value && typeof value === "object" ? value.code : null;
  // 会话切走之后按钮还在：这次点击发现没有工作区，两个按钮都该消失
  if (code === NO_PROJECT_ROOT_CODE) {
    rememberWorkspaceState(false);
    closeCorner();
    return { ok: false, code: NO_SESSION_DIR_CODE, message: NO_WORKSPACE_MESSAGE };
  }
  return value;
}

/**
 * 输入框插槽挂上来了：有工作区才把角落按钮也开出来。
 * 已经有层就不再开，免得重复挂载时叠出两个按钮。
 */
export function retainCorner() {
  cornerHolders += 1;
  // 还没加载完或已经有层就不动
  if (!currentPi || corner) {
    return;
  }
  corner = openCornerButton(currentPi, globalThis.document, {
    language: currentLanguage(),
    invoke: runOpen,
  });
}

/**
 * 一个输入框插槽撤了：最后一个撤走时才收掉角落按钮。
 */
export function releaseCorner() {
  cornerHolders -= 1;
  // 还有别的挂载点留着就先不收
  if (cornerHolders > 0) {
    return;
  }
  cornerHolders = 0;
  closeCorner();
}

/**
 * 收掉角落按钮，但不动引用计数。
 * 会话没有工作区时按钮要立刻消失，可插槽还挂着（还要负责重新挂回来）。
 */
export function closeCorner() {
  // 没开过就没什么可收的
  if (!corner) {
    return;
  }
  corner.close();
  corner = null;
}

/**
 * 把可能残留的层全部收掉。插件卸载时兜底。
 */
export function releaseCorners() {
  cornerHolders = 0;
  closeCorner();
}

/**
 * 插件侧回答要显示的一句话：成功不显示文字，失败用插件给的原因。
 * @param {unknown} value 插件侧或打开流程的返回值
 * @returns {string}
 */
export function messageFor(value) {
  // 只有明确的 ok:true 才算成功
  if (value && typeof value === "object" && value.ok === true) {
    return "";
  }
  // 插件侧给了说明就直接用
  if (value && typeof value === "object" && typeof value.message === "string" && value.message) {
    return value.message;
  }
  return "打开失败。";
}

/**
 * 一句话该用哪种颜色：成功不写话，失败用错误色。
 * @param {unknown} value 插件侧的返回值
 * @returns {string}
 */
export function resultKind(value) {
  // 成功不显示文字，用不上颜色
  if (value && typeof value === "object" && value.ok === true) {
    return "";
  }
  return "error";
}

/**
 * 派发被宿主拒绝时按钮上显示的一句话。
 * @param {unknown} error
 * @returns {string}
 */
export function errorText(error) {
  const code = error && typeof error === "object" ? String(error.code ?? "") : "";
  // 宿主给单次调用的预算是 2 秒，超了只说明还在跑
  if (code === "PLUGIN_CALL_TIMEOUT") {
    return "打开超时。";
  }
  // 插件侧的失败说明优先于通用文案
  if (error && typeof error === "object" && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "打开失败。";
}

/**
 * 输入框工具条右侧的按钮：只在这一行有工作区时才画出来。
 * 它同时是角落按钮的开关：有工作区就开层，没有就什么都不挂。
 * 宿主只把 position 传进来，这里不看它。
 */
export function OpenButton() {
  const pair = useState({ status: workspaceState, busy: false, text: "", kind: "" });
  const state = pair[0];
  const setState = pair[1];

  // 挂上插槽就探测一次：宿主重挂插槽时会重问，不留上一个会话的结果
  useEffect(function () {
    let alive = true;
    probeWorkspace().then(function (yes) {
      // 组件已经卸载：别再改状态，也别开层
      if (!alive) {
        return;
      }
      setState({ status: rememberWorkspaceState(yes), busy: false, text: "", kind: "" });
      // 角落按钮跟着工作区一起出现或消失
      if (yes) {
        retainCorner();
        return;
      }
      closeCorner();
    });
    return function () {
      alive = false;
      releaseCorner();
    };
  }, []);

  /**
   * 真实点击才能派发，宿主会校验用户手势。
   */
  function onClick() {
    // 已经在打开就忽略重复点击，避免连开多个窗口
    if (state.busy) {
      return;
    }
    setState({ status: state.status, busy: true, text: "", kind: "" });
    runOpen().then(
      function (value) {
        const code = value && typeof value === "object" ? value.code : null;
        // 这次点击发现没有工作区：按钮撤掉，只留一句话说明
        if (code === NO_SESSION_DIR_CODE) {
          setState({ status: STATE_NO, busy: false, text: messageFor(value), kind: "hint" });
          return;
        }
        setState({
          status: state.status,
          busy: false,
          text: messageFor(value),
          kind: resultKind(value),
        });
      },
      function (error) {
        setState({ status: state.status, busy: false, text: errorText(error), kind: "error" });
      }
    );
  }

  // 还在探测、或者已经知道没有工作区又没话可说：这一行不放任何东西
  if (state.status === STATE_UNKNOWN) {
    return null;
  }
  if (state.status === STATE_NO && state.text === "") {
    return null;
  }

  // 没有工作区就不画按钮，这一行最多只留那句说明
  const button =
    state.status === STATE_YES
      ? h(
          "button",
          {
            type: "button",
            className: "pov-btn",
            title: "用 VSCode 打开当前工作目录",
            "aria-label": "用 VSCode 打开当前工作目录",
            disabled: state.busy,
            onClick: onClick,
          },
          "VSCode"
        )
      : null;

  return h(
    "span",
    { className: "pov-action", "data-pov": "composer-control" },
    button,
    // 失败或「没有工作区」时补一句原因
    state.text
      ? h("output", { className: "pov-out", "data-pov-result": state.kind }, state.text)
      : null
  );
}

/**
 * 插件加载：注入样式、注册输入框按钮。
 * 角落按钮不在这里挂——它跟随输入框插槽的探测结果。
 * @param {object} pi 宿主给的渲染器 API
 */
export function onLoad(pi) {
  currentPi = pi;
  pi.ui.injectStyle(PLUGIN_CSS);
  pi.slots.register({ slot: "composerControl", positions: ["right"], component: OpenButton });
}

/**
 * 插件卸载：收掉可能还开着的层，松开 pi。
 */
export function onUnload() {
  releaseCorners();
  currentPi = null;
  workspaceState = STATE_UNKNOWN;
}
