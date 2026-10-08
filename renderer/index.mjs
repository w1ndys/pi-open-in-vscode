/**
 * 渲染器入口：在窗口右下角挂一个常驻按钮，只在对话界面里出现。
 *
 * 这个模块不注册任何插槽，也不依赖 react：按钮画在宿主给的自绘层里
 * （pi.ui.openLayer，官方规格 docs/plugin-plan/ui/self-dialog 的自绘层做法）。
 * 自绘层挂在窗口上，不随页面切换消失，所以「该不该显示」必须自己盯。
 *
 * 三个条件同时满足才显示：
 *   1. 宿主渲染出了输入框（.composer-shell）——说明现在真的是对话界面；
 *   2. 输入框确实露在外面，没有被设置页之类的整页界面盖住；
 *   3. 这次对话有工作区（插件主进程读一次项目根，拿不到就不显示）。
 *
 * 页面切换、输入框重挂都会改 DOM，所以用 MutationObserver 盯，合并成一次检查。
 */

import { PLUGIN_CSS } from "./styles.mjs";
import { openCornerButton } from "./corner.mjs";
import { stackCornerButton } from "./corner-stack.mjs";

/** 判断「是不是对话界面」用的输入框类名，取自宿主自己的样式表。 */
const COMPOSER_SELECTOR = ".composer-shell";

/** 设置页打开时宿主给根容器加的类名：整页界面会把对话盖住，但对话的 DOM 还在。 */
const SETTINGS_SELECTOR = ".app-shell.settings-mode";

/** 按钮上要画的元素类名，也用来清掉上一次加载残留的层。 */
const CORNER_SELECTOR = ".pov-corner";

/** 探测「这次对话有没有工作区」的方法名，必须与 manifest.rendererCallMethods 一致。 */
const PROBE_METHOD = "hasWorkspace";

/** 打开当前项目根的方法名，必须与 manifest.rendererCallMethods 一致。 */
const CALL_METHOD = "openWorkspace";

/**
 * 插件侧「本次对话没有工作区」的错误码。
 * 渲染器是浏览器 ESM，require 不了业务层，只能写同一份字面量；
 * 导出出来是为了让测试断言它与业务层的常量一致（防漂移）。
 */
export const NO_PROJECT_ROOT_CODE = "NO_PROJECT_ROOT";

/** 界面自己认的错误码：这次点击发现没有工作区。 */
export const NO_SESSION_DIR_CODE = "NO_SESSION_DIR";

/** 没有工作区时留给用户的一句话。 */
export const NO_WORKSPACE_MESSAGE = "本次对话没有工作区（临时会话），这个按钮已隐藏。";

/** 多次 DOM 变动合并成一次检查的等待时长。 */
const SYNC_DELAY_MS = 50;

/** 按钮没显示时，最多隔多久重新问一次有没有工作区（用户换会话后按钮能自己回来）。 */
const REPROBE_INTERVAL_MS = 1500;

/**
 * 点一次发现没有工作区的说明停留多久再把按钮收掉，留给用户看一眼原因。
 * 比角落按钮自己的「失败」停留时间略长：先让原因显示完，再收掉整颗按钮。
 */
export const HIDE_AFTER_FAIL_MS = 2800;

/** 当前加载周期的 pi。宿主每次加载都给一个新的。 */
let currentPi = null;

/** 现在开着的角落按钮层；没开就是 null。 */
let corner = null;

/** 上一次看到的输入框元素，用来判断是不是换了输入框（换会话、切页面回来都会重挂）。 */
let composerElement = null;

/** 探测序号：只认最后一次探测的结果，免得旧结果盖掉新结果。 */
let probeSeq = 0;

/** 上一次探测的时间，用来给「按钮没开时重新问一遍」限速。 */
let lastProbeAt = 0;

/** 合并 DOM 变动的定时器句柄。 */
let syncTimer = null;

/** 正在盯的 MutationObserver；没盯就是 null。 */
let observer = null;

/** 收按钮的定时器句柄。 */
let hideTimer = null;

/**
 * 应用语言标签。Electron 里 navigator.language 跟随应用语言。
 * @returns {string}
 */
function currentLanguage() {
  const nav = globalThis.navigator;
  return nav && typeof nav.language === "string" ? nav.language : "en";
}

/**
 * 元素是不是真的露在屏幕上。
 * 用左半边中间那个点做一次命中测试：被整页界面盖住、被挤到视口外、没有尺寸，都不算。
 * @param {Element} element
 * @returns {boolean}
 */
function isOnScreen(element) {
  const rect = element.getBoundingClientRect();
  // 没有尺寸（display:none 的祖先、被压成零宽）就没有可测的点
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  // 取左半边中间那个点：避开右下角，免得命中的是插件自己那颗按钮
  const x = rect.left + rect.width * 0.3;
  const y = rect.top + rect.height / 2;
  // 点落在视口外时 elementFromPoint 返回 null
  const hit = globalThis.document.elementFromPoint(x, y);
  // 命中点必须是输入框自己，或者是它里面的元素
  return hit !== null && (hit === element || element.contains(hit));
}
/**
 * 现在该不该显示按钮所依据的输入框。
 * 没有输入框、输入框被盖住、或者正停在设置页，都返回 null。
 * @returns {Element | null}
 */
function findComposer() {
  // 设置页是整页界面：对话还挂着但被盖住了，先按页面状态排除
  if (globalThis.document.querySelector(SETTINGS_SELECTOR)) {
    return null;
  }
  const composers = globalThis.document.querySelectorAll(COMPOSER_SELECTOR);
  let index = 0;
  while (index < composers.length) {
    const composer = composers[index];
    // 同一个界面里可能有多个输入框，只认真的露在屏幕上的那一个
    if (isOnScreen(composer)) {
      return composer;
    }
    index += 1;
  }
  return null;
}

/**
 * 问一次插件有没有工作区，有就把按钮画出来。
 */
function askThenShow() {
  lastProbeAt = Date.now();
  probeSeq += 1;
  const seq = probeSeq;
  probeWorkspace().then(function (hasWorkspace) {
    // 期间又问过一次、或者已经离开对话界面：这次结果作废
    if (seq !== probeSeq || composerElement === null) {
      return;
    }
    // 没有工作区就不显示：点下去也不知道该打开哪一个目录
    if (!hasWorkspace) {
      hideCorner();
      return;
    }
    showCorner();
  });
}

/**
 * 检查一次当前该不该显示，需要时才开或收；顺带把按钮带重排一次。
 * 导出是给测试直接调用的，正常由 MutationObserver 触发。
 */
export function sync() {
  syncVisibility();
  // 别的插件可能刚出现或刚消失：不管这次该不该显示，都重排一次按钮带
  restackCorner();
}

/**
 * 按当前页面决定开还是收按钮。
 */
function syncVisibility() {
  const composer = findComposer();
  // 不在对话界面：收起来，并忘掉上一次的输入框
  if (!composer) {
    composerElement = null;
    hideCorner();
    return;
  }
  // 换了输入框（换会话、从别的页面切回来）就立刻重新问一次
  if (composer !== composerElement) {
    composerElement = composer;
    askThenShow();
    return;
  }
  // 还是同一个输入框、按钮却不在（没工作区，或者刚点过一次失败）：
  // 隔一段时间再问一次，用户切回有工作区的会话时按钮能自己回来
  if (!corner && Date.now() - lastProbeAt >= REPROBE_INTERVAL_MS) {
    askThenShow();
  }
}

/**
 * 安排一次检查。DOM 变动很密（流式回复时一直在变），所以合并成一次。
 */
function scheduleSync() {
  // 已经排过一次就等它跑完
  if (syncTimer !== null) {
    return;
  }
  syncTimer = globalThis.setTimeout(function () {
    syncTimer = null;
    sync();
  }, SYNC_DELAY_MS);
}

/**
 * 开始盯 DOM：页面切换、输入框重挂都会产生变动。
 */
function startWatching() {
  observer = new globalThis.MutationObserver(scheduleSync);
  observer.observe(globalThis.document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
}

/**
 * 停止盯 DOM，清掉还没跑的定时器。
 */
function stopWatching() {
  // 没开过观察器就不用摘
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  // 还没跑的检查一并取消
  if (syncTimer !== null) {
    globalThis.clearTimeout(syncTimer);
    syncTimer = null;
  }
  // 还没收的按钮层定时器也取消
  if (hideTimer !== null) {
    globalThis.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/**
 * 把角落按钮画出来。已经开着就不重复开。
 */
function showCorner() {
  // 还没加载完或者已经开着：都不动
  if (!currentPi || corner) {
    return;
  }
  corner = openCornerButton(currentPi, globalThis.document, {
    language: currentLanguage(),
    invoke: runOpen,
  });
  // 刚挂上，先量一次：别的插件已经在的话，自己要让到它们上面
  restackCorner();
}

/**
 * 让按钮带重排一次。只有角落按钮开着的时候才有事可做。
 */
function restackCorner() {
  // 没开着按钮就没什么可排
  if (!corner) {
    return;
  }
  stackCornerButton(globalThis.document, corner.button);
}

/**
 * 收掉角落按钮的层。
 */
function hideCorner() {
  // 没开过就没什么可收的
  if (!corner) {
    return;
  }
  corner.close();
  corner = null;
}

/**
 * 收掉上一次加载残留的层。
 * 宿主热重载时会重新加载本模块，上一轮那个实例开出来的层已经没人能关了，
 * 留着就会一直挂在窗口上——先把它摘掉，再按当前页面重新决定要不要画。
 */
function removeStaleLayers() {
  const stale = globalThis.document.querySelectorAll(CORNER_SELECTOR);
  let index = 0;
  while (index < stale.length) {
    stale[index].remove();
    index += 1;
  }
}

/**
 * 问一次插件：这次对话有没有工作区。
 * 答案不是 true、或宿主拒绝这次调用，都按「没有」处理——
 * 按钮不出现，好过点一下去打开一个猜出来的目录。
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
 * 打开流程：成功原样返回；没有工作区时先把原因亮出来，稍后把按钮收掉。
 * @returns {Promise<unknown>}
 */
export async function runOpen() {
  // 还没加载完就没法派发
  if (!currentPi) {
    return { ok: false, code: NO_SESSION_DIR_CODE, message: NO_WORKSPACE_MESSAGE };
  }
  const value = await currentPi.dispatch("plugin.call", { method: CALL_METHOD, args: {} });
  // 成功就原样交给按钮去显示「已打开」
  if (value && typeof value === "object" && value.ok === true) {
    return value;
  }
  const code = value && typeof value === "object" ? value.code : null;
  // 没有项目根：这次对话没得打开，让按钮显示原因，随后自己收掉
  if (code === NO_PROJECT_ROOT_CODE) {
    scheduleHideCorner();
    return { ok: false, code: NO_SESSION_DIR_CODE, message: NO_WORKSPACE_MESSAGE };
  }
  return value;
}

/**
 * 稍后再收按钮：让「失败」与原因在按钮上停一会儿，用户看得到。
 */
function scheduleHideCorner() {
  // 上一次的收尾还没跑就取消，免得两段计时互相打断
  if (hideTimer !== null) {
    globalThis.clearTimeout(hideTimer);
  }
  hideTimer = globalThis.setTimeout(function () {
    hideTimer = null;
    composerElement = null;
    hideCorner();
  }, HIDE_AFTER_FAIL_MS);
}

/**
 * 插件加载：注入样式、清掉残留层、开始盯 DOM。
 * 按钮不在这里画——先看一眼现在是不是对话界面、这次对话有没有工作区。
 * @param {object} pi 宿主给的渲染器 API
 */
export function onLoad(pi) {
  currentPi = pi;
  pi.ui.injectStyle(PLUGIN_CSS);
  removeStaleLayers();
  composerElement = null;
  lastProbeAt = 0;
  startWatching();
  // 加载时可能已经停在对话界面，先看一眼
  scheduleSync();
}

/**
 * 插件卸载：停掉监听、收掉层、松开 pi。
 */
export function onUnload() {
  stopWatching();
  hideCorner();
  composerElement = null;
  // 让还在飞的探测结果作废
  probeSeq += 1;
  currentPi = null;
}
