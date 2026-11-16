const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { resolveLaunch } = require('./terminal-utils.js');
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function sessionId(profile) {
  try {
    const launch = resolveLaunch(profile);
    return (launch.sessionId || launch.command.match(/\bcodex\b[^\r\n]*\bresume\s+([0-9a-f-]{36})(?:\s|$)/i)?.[1] || '').toLowerCase();
  } catch { return ''; }
}
function createDiscovery(home) {
  const cache = new Map();
  async function files(directory, wanted, result) {
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await files(file, wanted, result);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const id = entry.name.match(uuid)?.[0].toLowerCase();
        if (wanted.has(id)) result.push({ file, id });
      }
    }
  }
  async function read(file, id, errors) {
    try {
      const stat = await fs.promises.stat(file), key = `${stat.mtimeMs}:${stat.size}`;
      if (cache.get(file)?.key === key) return cache.get(file).value;
      let value = null, verified = false;
      const input = fs.createReadStream(file, { encoding: 'utf8' });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!/"type"\s*:\s*"(?:session_meta|turn_context)"/.test(line)) continue;
          let item; try { item = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { continue; }
          if (item.type === 'session_meta') verified = item.payload?.id?.toLowerCase() === id;
          if (!verified || !['session_meta', 'turn_context'].includes(item.type)) continue;
          const cwd = item.payload?.cwd;
          if (typeof cwd === 'string' && (path.win32.isAbsolute(cwd) || path.posix.isAbsolute(cwd))) value = { cwd, timestamp: Date.parse(item.timestamp) || 0 };
        }
      } finally { lines.close(); input.destroy(); }
      if (value) cache.set(file, { key, value });
      else errors.set(id, verified ? '记录中没有有效的工作目录' : '无法验证会话记录，请稍后刷新');
      return value;
    } catch (error) { errors.set(id, `读取记录失败（${error.code || 'UNKNOWN'}），请稍后刷新`); return null; }
  }
  return async profiles => {
    const wanted = new Set(profiles.map(sessionId).filter(Boolean)), candidates = [], found = new Map(), errors = new Map();
    found.errors = errors;
    if (!wanted.size) return found;
    await files(path.join(home, 'sessions'), wanted, candidates);
    await files(path.join(home, 'archived_sessions'), wanted, candidates);
    for (const { file, id } of candidates) {
      const value = await read(file, id, errors);
      if (value && (!found.has(id) || value.timestamp >= found.get(id).timestamp)) found.set(id, value);
    }
    for (const id of wanted) {
      if (found.has(id)) errors.delete(id);
      else if (!errors.has(id)) errors.set(id, '未找到本地会话记录，请确认会话 ID 和 CODEX_HOME');
    }
    return found;
  };
}
module.exports = { createDiscovery, sessionId };
