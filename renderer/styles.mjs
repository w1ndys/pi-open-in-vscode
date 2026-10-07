/**
 * 按钮样式。pi.ui.injectStyle 会把规则限定在本插件自己的插槽挂载点内，
 * 所以普通类名就够；颜色用宿主的设计变量，跟随明暗主题。
 */
export const BUTTON_CSS = `
.pov-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pov-btn {
  padding: 1px 8px;
  white-space: nowrap;
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  background: transparent;
  color: var(--ds-accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pov-btn:hover:not(:disabled) {
  background: var(--ds-bg-hover);
}
.pov-btn:disabled {
  opacity: .6;
  cursor: default;
}
.pov-out {
  color: var(--ds-text-muted);
  font-size: 12px;
}
`;
