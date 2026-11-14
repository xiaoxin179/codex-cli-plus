const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createActivityLog } = require('../src/activity-log.cjs');

test('activity log batches metadata and retains only three bounded files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-log-test-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const log = createActivityLog(directory, 'test', {maxBytes:180});
  for (let i = 0; i < 6; i++) {
    log.record('session-id', {event:'transition', busy:!!(i % 2), index:i});
    log.flush();
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), ['activity.jsonl', 'activity.jsonl.1', 'activity.jsonl.2']);
  const latest = JSON.parse(fs.readFileSync(path.join(directory, 'activity.jsonl'), 'utf8'));
  assert.equal(latest.index, 5);
  assert.equal(latest.session, 'session-id');
  assert.equal(latest.version, 'test');
  assert.ok(Date.parse(latest.time));
});
test('unwritable log destination does not throw', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-log-test-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const file = path.join(directory, 'file');
  fs.writeFileSync(file, '');
  const log = createActivityLog(file, 'test');
  log.record('id', {event:'session-start'});
  assert.doesNotThrow(() => log.flush());
});
