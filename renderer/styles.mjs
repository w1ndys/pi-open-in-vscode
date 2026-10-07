/**
 * 插件自己注入的样式：只有窗口右下角那个角落按钮。
 * pi.ui.injectStyle 会把规则限定在本插件自己的挂载点内（自绘层容器带 data-pi-plugin），
 * 所以普通类名就够。颜色用宿主的设计变量并留了兜底值，跟随明暗主题。
 */
export const PLUGIN_CSS = `
/* ---- 角落按钮（自绘层）----
   定位照官方 renderer-slots/slot-shell.css 的 .p-overlay__corner：
   铺满视口的 flex 盒子负责把按钮推到右下角，
   盒子本身 pointer-events: none，只有按钮接收点击，所以不挡别的内容。
   按钮只在对话界面里显示，显示条件由 renderer/index.mjs 盯着 DOM 判断。 */
.pov-corner {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 16px;
  pointer-events: none;
}
.pov-corner > * {
  pointer-events: auto;
}
.pov-corner-btn {
  padding: 5px 12px;
  white-space: nowrap;
  border: 1px solid var(--ds-border-default, rgba(127, 127, 127, .4));
  border-radius: 999px;
  background: var(--ds-bg-elevated, rgba(28, 28, 28, .86));
  color: var(--ds-text-primary, #ededed);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .28);
}
.pov-corner-btn:hover:not(:disabled) {
  background: var(--ds-bg-hover, rgba(64, 64, 64, .92));
}
.pov-corner-btn:disabled {
  opacity: .7;
  cursor: default;
}
`;
