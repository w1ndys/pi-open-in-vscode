/**
 * 实体层：一次「打开工作目录」动作的结果。
 * 成功带目录和方法，失败带错误码和给人看的说明。
 */

/**
 * 打开成功。
 * @param {string} dir 被打开的绝对路径
 * @param {string} method 实际用的方式：uri / code / open
 */
function okResult(dir, method) {
  return { ok: true, dir: dir, method: method };
}

/**
 * 打开失败。
 * @param {string} code 稳定错误码
 * @param {string} message 给人看的说明
 */
function failResult(code, message) {
  return { ok: false, code: code, message: message };
}

module.exports = { okResult, failResult };
