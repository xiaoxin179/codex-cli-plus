const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadSettings } = require('../src/settings.cjs');

test('renaming preserves legacy presets without overwriting existing settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-plus-settings-'));
  try {
    const legacy = path.join(root, 'old'), current = path.join(root, 'new');
    fs.mkdirSync(legacy);
    const original = { profiles: [{id:'preset',name:'Existing session',cwd:'',sessionId:'12345678-1234-4abc-8def-123456789abc'}], icon:'C:\\saved-icon.png' };
    fs.writeFileSync(path.join(legacy,'settings.json'), JSON.stringify(original));
    assert.deepEqual(loadSettings(current, legacy), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(current,'settings.json'),'utf8')), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacy,'settings.json'),'utf8')), original);
    const updated = {profiles:[]};
    fs.writeFileSync(path.join(current,'settings.json'), JSON.stringify(updated));
    assert.deepEqual(loadSettings(current, legacy), updated);
    fs.writeFileSync(path.join(current,'settings.json'), 'invalid');
    assert.deepEqual(loadSettings(current, legacy), {});
    assert.equal(fs.readFileSync(path.join(current,'settings.json'),'utf8'), 'invalid');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
