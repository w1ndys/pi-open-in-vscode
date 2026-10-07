/**
 * react 桩：只实现测试需要的三个导出，
 * 让渲染器模块能在 Node 里被导入，不必跑真正的 React。
 */

/** 收集 useEffect 返回的清理函数，好让用例模拟「组件卸载」。 */
export const cleanups = [];

export function createElement(type, props, ...children) {
  return { type: type, props: { ...(props ?? {}), children: children } };
}

export function useState(initial) {
  let value = initial;
  return [value, function (next) {
    value = next;
  }];
}

export function useEffect(effect) {
  // 测试里当场执行一次，当作挂载；清理函数存起来等用例自己调
  const cleanup = effect();
  // 只有真的返回了函数才记，免得把 undefined 也塞进去
  if (typeof cleanup === "function") {
    cleanups.push(cleanup);
  }
  return cleanup;
}
