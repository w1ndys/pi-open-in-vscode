/**
 * 右下角按钮带：把同一个窗口里所有角落按钮排成一竖列，互不重叠。
 *
 * 宿主没有「角落」这种槽位（0.16.1 的 rendererSlots 只有 composerControl 那几个），
 * 每个插件都是自己用 pi.ui.openLayer() 往右下角画一颗，位置只能自己协商。
 * 所以定一条约定：凡是在右下角画常驻按钮的插件，都给按钮加属性
 * data-pi-corner-button（空值），就算加入了这条按钮带——
 * 文档里靠前的贴右下角，后面的按下面几颗按钮的高度往上让位。
 *
 * 让位用 transform: translateY()，只改绘制不改布局，也不影响别家量高度；
 * 高度取 getBoundingClientRect().height，隐藏（高度为 0）的按钮跳过、不占位。
 * 每颗按钮只给自己让位、不碰别家的元素，各家各算一次，结果一致。
 */

/** 加入按钮带的标记属性。任何插件的角落按钮都该带上它。 */
export const CORNER_BUTTON_ATTR = "data-pi-corner-button";

/** 两颗按钮之间的竖向间距。约定成固定值，各家算出来的位置才一致。 */
export const CORNER_GAP_PX = 8;

/**
 * 按钮此刻露出的高度；隐藏时为 0。
 * @param {Element} button
 * @returns {number}
 */
function visibleHeight(button) {
  const rect = button.getBoundingClientRect();
  // 没有尺寸（display:none 之类）就不占位
  if (!rect || rect.height <= 0) {
    return 0;
  }
  return rect.height;
}

/**
 * 把让位写进按钮自身的内联 transform。
 * @param {Element} button
 * @param {number} offset 向上让位的像素数
 */
function applyOffset(button, offset) {
  const next = offset > 0 ? "translateY(-" + offset + "px)" : "";
  // 值没变就不写：写 style 会再触发一次 MutationObserver
  if (button.style.transform === next) {
    return;
  }
  button.style.transform = next;
}

/**
 * 只给自己排队：按文档顺序找出所有角落按钮，算出自己下面有几颗、共多高，再往上让位。
 * 别家的按钮只用来量高度，不写它们的样式。
 * @param {Document} doc
 * @param {Element} ownButton 自己那颗按钮；必须带着 CORNER_BUTTON_ATTR
 */
export function stackCornerButton(doc, ownButton) {
  const buttons = doc.querySelectorAll("[" + CORNER_BUTTON_ATTR + "]");
  let offset = 0;
  let index = 0;
  while (index < buttons.length) {
    const button = buttons[index];
    const height = visibleHeight(button);
    // 隐藏的按钮既不让位也不占位，直接跳过
    if (height > 0) {
      // 轮到自己：用累计出来的位置
      if (button === ownButton) {
        applyOffset(button, offset);
        return;
      }
      offset += height + CORNER_GAP_PX;
    }
    index += 1;
  }
  // 没在文档里找到自己（还没挂上）：什么都不做
}
