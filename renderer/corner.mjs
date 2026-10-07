/**
 * 角落按钮：自绘层里一个贴在窗口右下角的小按钮。
 *
 * 依据官方规格 `docs/plugin-plan/ui/self-dialog/`（status: finalized）：
 * 全屏弹窗与角落浮层由插件自理——无槽、无注册，插件在自己的元素里 position: fixed 自画。
 * 层容器由宿主提供，是 0×0 的 fixed 元素，所以只要自己不铺满屏幕就挡不住别的内容。
 * 定位写法照官方 `apps/desktop/src/plugins/renderer-slots/slot-shell.css` 的 .p-overlay__corner：
 * 铺满视口的 flex 盒子 + pointer-events: none，只让按钮本身接收点击。
 */

/** 按钮的四个状态，决定显示哪个字。 */
export const PHASE_IDLE = "idle";
export const PHASE_BUSY = "busy";
export const PHASE_DONE = "done";
export const PHASE_FAIL = "fail";

/** 成功后与失败后的停留时长。 */
const DONE_HOLD_MS = 1200;
const FAIL_HOLD_MS = 2600;

/** 文案表：en 与 zh-CN 键一一对应，界面上不留写死的可见文案。 */
const COPY = {
  en: {
    idle: "VSCode",
    busy: "Opening",
    done: "Opened",
    fail: "Failed",
    hint: "Open the current workspace folder in Visual Studio Code; shown only in conversations that have a workspace.",
    failedHint: "This button could not open VS Code.",
  },
  "zh-CN": {
    idle: "VSCode",
    busy: "打开中",
    done: "已打开",
    fail: "失败",
    hint: "用 VSCode 打开当前工作目录；只在有工作区的对话里出现。",
    failedHint: "这个按钮没能打开 VSCode。",
  },
};

/** 默认定时器。测试可以换成只记录不执行的实现，避免真的等 1 秒多。 */
const DEFAULT_TIMERS = {
  schedule: function (task, delayMs) {
    return globalThis.setTimeout(task, delayMs);
  },
  cancel: function (handle) {
    globalThis.clearTimeout(handle);
  },
};

/**
 * 按语言标签选一份文案。Electron 里 navigator.language 跟随应用语言。
 * @param {unknown} tag 语言标签，如 zh-CN / en-US
 * @returns {object} 文案表
 */
export function copyFor(tag) {
  const normalized = String(tag || "en").toLowerCase();
  // zh、zh-CN、zh-Hans、zh-TW 都归到简体那份
  if (normalized.startsWith("zh")) {
    return COPY["zh-CN"];
  }
  return COPY.en;
}

/**
 * 状态对应的按钮文字。
 * @param {object} copy 文案表
 * @param {string} phase 当前状态
 * @returns {string}
 */
export function labelFor(copy, phase) {
  // 三个非空闲状态各有自己的字，其余都算空闲
  if (phase === PHASE_BUSY) {
    return copy.busy;
  }
  if (phase === PHASE_DONE) {
    return copy.done;
  }
  if (phase === PHASE_FAIL) {
    return copy.fail;
  }
  return copy.idle;
}

/**
 * 造一份按钮状态。
 * @param {object} options { copy, invoke, timers }
 * @returns {object} 状态
 */
function createState(options) {
  return {
    copy: options.copy,
    invoke: options.invoke,
    timers: options.timers || DEFAULT_TIMERS,
    phase: PHASE_IDLE,
    pendingReset: null,
    busy: false,
  };
}

/**
 * 按当前状态刷新按钮。
 * @param {object} button 按钮元素
 * @param {object} state 状态
 * @param {string} [hint] 悬停提示，失败时用来说明原因
 */
function paintButton(button, state, hint) {
  button.textContent = labelFor(state.copy, state.phase);
  button.disabled = state.phase === PHASE_BUSY;
  // 有说明才写 title，否则清掉上一次留下的
  if (hint) {
    button.title = hint;
    return;
  }
  button.removeAttribute("title");
}

/**
 * 切到某个状态；给了停留时长就自动复位回空闲。
 * @param {object} button 按钮元素
 * @param {object} state 状态
 * @param {string} next 目标状态
 * @param {number} [holdMs] 停留毫秒数
 * @param {string} [hint] 悬停提示
 */
function setPhase(button, state, next, holdMs, hint) {
  // 上一次的复位还没跑就取消，免得两段计时互相打断
  if (state.pendingReset !== null) {
    state.timers.cancel(state.pendingReset);
    state.pendingReset = null;
  }
  state.phase = next;
  paintButton(button, state, hint);
  // 只在需要停留时才挂定时器
  if (holdMs) {
    state.pendingReset = state.timers.schedule(function () {
      state.pendingReset = null;
      state.phase = PHASE_IDLE;
      paintButton(button, state, state.copy.hint);
    }, holdMs);
  }
}

/**
 * 失败收尾：把原因放进悬停提示。
 * @param {object} button 按钮元素
 * @param {object} state 状态
 * @param {unknown} reason 插件结果或宿主错误
 */
function finishFailure(button, state, reason) {
  const message = reason && typeof reason.message === "string" ? reason.message : "";
  setPhase(button, state, PHASE_FAIL, FAIL_HOLD_MS, message || state.copy.failedHint);
}

/**
 * 请求结算：成功短暂显示，失败给原因。
 * @param {object} button 按钮元素
 * @param {object} state 状态
 * @param {unknown} result 插件侧的返回
 */
function finishOpen(button, state, result) {
  state.busy = false;
  // 插件侧返回 ok:false 说明这次没打开
  if (!result || result.ok !== true) {
    finishFailure(button, state, result);
    return;
  }
  setPhase(button, state, PHASE_DONE, DONE_HOLD_MS);
}

/**
 * 点一次只放一个请求出去。
 * @param {object} button 按钮元素
 * @param {object} state 状态
 */
function runOpen(button, state) {
  // 打开中忽略重复点击，避免连开多个窗口
  if (state.busy) {
    return;
  }
  state.busy = true;
  setPhase(button, state, PHASE_BUSY);
  state.invoke().then(
    function (result) {
      finishOpen(button, state, result);
    },
    function (error) {
      state.busy = false;
      finishFailure(button, state, error);
    }
  );
}

/**
 * 造出角落按钮的 DOM 与行为。
 * @param {Document} doc 文档对象，测试可注入假实现
 * @param {object} options { copy, invoke, timers }
 * @returns {object} 元素与供测试使用的小接口
 */
export function createCornerButton(doc, options) {
  const overlay = doc.createElement("div");
  overlay.className = "pov-corner";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "pov-corner-btn";
  overlay.appendChild(button);

  const state = createState(options);
  // 真实点击走这里
  button.addEventListener("click", function () {
    runOpen(button, state);
  });
  paintButton(button, state, state.copy.hint);

  return {
    element: overlay,
    button: button,
    /** 当前状态，测试用。 */
    phase: function () {
      return state.phase;
    },
    /** 手动触发一次点击，测试用。 */
    click: function () {
      runOpen(button, state);
    },
  };
}

/**
 * 开一个自绘层，把角落按钮画进去。
 * @param {object} pi 宿主给的渲染器 API
 * @param {Document} doc 文档对象
 * @param {object} options { language, invoke, timers }
 * @returns {object} { button, close }
 */
export function openCornerButton(pi, doc, options) {
  const layer = pi.ui.openLayer();
  const button = createCornerButton(doc, {
    copy: copyFor(options.language),
    invoke: options.invoke,
    timers: options.timers,
  });
  layer.element.appendChild(button.element);
  return {
    button: button,
    /** 关掉层。插件卸载时宿主也会收，这里主动关一次更干净。 */
    close: function () {
      layer.close();
    },
  };
}
