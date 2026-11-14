const fs = require('node:fs');
const path = require('node:path');

// Batched, bounded metadata log. Failure must never interrupt terminal output.
function createActivityLog(directory, version, { maxBytes = 1024 * 1024 } = {}) {
  const file = path.join(directory, 'activity.jsonl');
  let pending = [], timer = null;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const batch = pending.join('');
    pending = [];
    try {
      fs.mkdirSync(directory, { recursive: true });
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size && size + Buffer.byteLength(batch) > maxBytes) {
        if (fs.existsSync(file + '.2')) fs.unlinkSync(file + '.2');
        if (fs.existsSync(file + '.1')) fs.renameSync(file + '.1', file + '.2');
        fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, batch, 'utf8');
    } catch {}
  }
  function record(session, details) {
    pending.push(JSON.stringify({ time: new Date().toISOString(), version, session, ...details }) + '\n');
    if (pending.length >= 256) flush();
    else if (!timer) {
      timer = setTimeout(flush, 1000);
      timer.unref();
    }
  }
  return { record, flush };
}
module.exports = { createActivityLog };
