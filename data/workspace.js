/**
 * 数据层：从宿主读当前工作区路径。
 * 只负责取数，不决定怎么打开 VSCode。
 */

/**
 * 读取当前工作区绝对路径。
 * 没有打开项目或路径不是字符串时返回 null。
 * @param {{ get: () => Promise<{ path?: string } | null> }} workspaceApi
 * @returns {Promise<string | null>}
 */
async function readWorkspacePath(workspaceApi) {
  const workspace = await workspaceApi.get();
  // 宿主没给工作区对象，说明当前没有可打开的项目
  if (!workspace) {
    return null;
  }
  // 路径必须是非空字符串，空串不能当目录交给 VSCode
  if (typeof workspace.path !== "string" || workspace.path.trim() === "") {
    return null;
  }
  return workspace.path;
}

module.exports = { readWorkspacePath };
