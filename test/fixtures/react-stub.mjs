/**
 * react 桩：只实现测试需要的两个导出，
 * 让渲染器模块能在 Node 里被导入，不必跑真正的 React。
 */
export function createElement(type, props, ...children) {
  return { type: type, props: { ...(props ?? {}), children: children } };
}

export function useState(initial) {
  let value = initial;
  return [value, function (next) {
    value = next;
  }];
}
