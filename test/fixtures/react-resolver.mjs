/**
 * 解析钩子：把裸说明符 react 指到本地桩，
 * 让测试能在没有宿主 import map 的情况下导入渲染器模块。
 */
export async function resolve(specifier, context, nextResolve) {
  // 只接管 react，其余交给 Node 默认解析
  if (specifier === "react") {
    return { url: new URL("react-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
