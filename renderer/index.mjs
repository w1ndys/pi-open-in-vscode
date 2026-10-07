/**
 * 渲染器入口：在输入框那一行放一个按钮，并在窗口右下角放一个常驻按钮。
 * 无构建的 ES 模块；react 由宿主窗口的 import map 提供，
 * 角落按钮走自绘层，只用普通 DOM，不依赖 react。
 */
import { createElement as h, useState } from "react";
import { PLUGIN_CSS } from "./styles.mjs";
import { openCornerButton } from "./corner.mjs";

/** 插件侧 onRendererCall 认的方法名，必须与 manifest.rendererCallMethods 一致。 */
const CALL_METHOD = "openWorkspace";

/** 当前加载周期的 pi。宿主每次加载都给一个新的。 */
let currentPi = null;

/** 当前打开的角落按钮层。 */
let corner = null;

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
 * 插件侧回答成功时返回空串，失败时返回要显示的一句话。
 * @param {unknown} value 插件侧 onRendererCall 的返回值
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
 * 输入框工具条右侧的按钮：点一次就调插件主进程打开 VSCode。
 * 宿主只把 position 传进来，这里不看它。
 */
export function OpenButton() {
  const pair = useState({ busy: false, text: "" });
  const state = pair[0];
  const setState = pair[1];

  /**
   * 真实点击才能派发，宿主会校验用户手势。
   */
  function onClick() {
    // 已经在打开就忽略重复点击，避免连开多个窗口
    if (state.busy) {
      return;
    }
    setState({ busy: true, text: "" });
    invokeOpen().then(
      function (value) {
        setState({ busy: false, text: messageFor(value) });
      },
      function (error) {
        setState({ busy: false, text: errorText(error) });
      }
    );
  }

  return h(
    "span",
    { className: "pov-action", "data-pov": "composer-control" },
    h(
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
    ),
    // 失败时在按钮旁边补一句原因
    state.text
      ? h("output", { className: "pov-out", "data-pov-result": "error" }, state.text)
      : null
  );
}

/**
 * 插件加载：注入样式、注册输入框按钮、挂出角落按钮。
 * @param {object} pi 宿主给的渲染器 API
 */
export function onLoad(pi) {
  currentPi = pi;
  pi.ui.injectStyle(PLUGIN_CSS);
  pi.slots.register({ slot: "composerControl", positions: ["right"], component: OpenButton });
  corner = openCornerButton(pi, globalThis.document, {
    language: currentLanguage(),
    invoke: invokeOpen,
  });
}

/**
 * 插件卸载：关掉自绘层，松开 pi。
 */
export function onUnload() {
  // 层是本次加载开的，主动关一次
  if (corner) {
    corner.close();
    corner = null;
  }
  currentPi = null;
}
