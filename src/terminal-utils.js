(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TerminalUtils = Object.freeze(factory());
})(globalThis, function () {
  const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function resolveLaunch(profile = {}) {
    let sessionId = typeof profile.sessionId === 'string' ? profile.sessionId.trim() : '';
    const command = typeof profile.command === 'string' ? profile.command.trim().slice(0, 4096) : '';
    if (!sessionId && sessionIdPattern.test(command)) sessionId = command;
    if (sessionId && !sessionIdPattern.test(sessionId)) throw new Error('请输入有效的会话 ID，例如 12345678-1234-4abc-8def-123456789abc');
    return { sessionId, command: sessionId ? `codex --no-daemon resume ${sessionId}` : command };
  }
  function cleanTitle(value) {
    const clean = String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
    // The terminal renders its own activity indicator; hide Codex's title spinner.
    return Array.from(clean.replace(/^[\u2800-\u28ff]+\s*/, '').trim()).slice(0, 240).join('');
  }
  return { resolveLaunch, cleanTitle };
});
