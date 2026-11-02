const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { validDirectory, dimensions, shellArguments, terminalEnvironment } = require('../src/session.cjs');
const { ActivityTracker } = require('../src/activity.cjs');
const { resolveLaunch, cleanTitle } = require('../src/terminal-utils.js');
test('a session ID generates the exact resume command, including legacy ID-only entries', () => {
  const id = '12345678-1234-4abc-8def-123456789abc';
  const expected = { sessionId: id, command: `codex --no-daemon resume ${id}` };
  assert.deepEqual(resolveLaunch({sessionId: ` ${id} `}), expected);
  assert.deepEqual(resolveLaunch({command: id}), expected);
  assert.deepEqual(resolveLaunch({command: 'npm run dev'}), {sessionId:'',command:'npm run dev'});
  assert.deepEqual(resolveLaunch(), {sessionId:'',command:''});
  assert.throws(()=>resolveLaunch({sessionId:id+'; Write-Output injected'}), /会话 ID/);
  assert.throws(()=>resolveLaunch({sessionId:'not-an-id'}), /会话 ID/);
});
test('strip only leading Codex spinner frames, preserving the thread name', () => {
  for (const frame of '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏') {
    assert.equal(cleanTitle(frame+' 获取当前会话 ID | 项目'), '获取当前会话 ID | 项目');
    assert.equal(cleanTitle('● '+frame+' 获取当前会话 ID | 项目'), '获取当前会话 ID | 项目');
    assert.equal(cleanTitle(frame+' ● 获取当前会话 ID | 项目'), '获取当前会话 ID | 项目');
  }
  assert.equal(cleanTitle('● 总结面试语料 | 项目'), '总结面试语料 | 项目');
  assert.equal(cleanTitle('● ⠇'), '');
  assert.equal(cleanTitle('项目 ● 名称'), '项目 ● 名称');
  assert.equal(cleanTitle('正常标题'), '正常标题');
  assert.equal(cleanTitle('项目⠇名称'), '项目⠇名称');
  assert.equal(cleanTitle('⠇'), '');
  assert.equal(cleanTitle('\u0000⠇ 标题\n'), '标题');
});
test('invalid working directories fall back to home', () => {
  assert.equal(validDirectory('Z:\\does-not-exist'), os.homedir());
  assert.equal(validDirectory(__filename), os.homedir());
  assert.equal(validDirectory(__dirname), __dirname);
});
test('PTY dimensions are bounded', () => {
  assert.deepEqual(dimensions(-10, 99999), { cols: 2, rows: 200 });
  assert.deepEqual(dimensions(undefined, 'bad'), { cols: 80, rows: 24 });
});
test('interactive terminals do not inherit automation color suppression', () => {
  const parent = { PATH: 'keep', NO_COLOR: '1', FORCE_COLOR: '0', CLICOLOR: '0', CLICOLOR_FORCE: '0', CODEX_CI: '1', TERM: 'dumb', COLORTERM: '', CI: 'project-setting' };
  const env = terminalEnvironment(parent, '0.3.2');
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.FORCE_COLOR, undefined);
  assert.equal(env.CLICOLOR_FORCE, undefined);
  assert.equal(env.CODEX_CI, undefined);
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.CLICOLOR, '1');
  assert.equal(env.TERM_PROGRAM, 'CodexCLIPlus');
  assert.equal(env.TERM_PROGRAM_VERSION, '0.3.2');
  assert.equal(env.PATH, 'keep'); assert.equal(env.CI, 'project-setting');
  assert.equal(parent.NO_COLOR, '1', 'parent environment must remain unchanged');
  assert.equal(terminalEnvironment({ no_color: '1', Term: 'dumb' }).no_color, undefined);
  assert.equal(terminalEnvironment({ no_color: '1', Term: 'dumb' }).Term, undefined);
});
test('plain terminals retain the prompt and never auto-launch an agent', () => {
  assert.ok(shellArguments().includes('-NoExit'));
  assert.match(shellArguments().at(-1), /__ctOriginalPrompt/);
  assert.doesNotMatch(shellArguments().at(-1), /codex/);
  assert.ok(shellArguments('npm run dev').at(-1).endsWith(' & { npm run dev\n }'));
});
test('OSC progress survives every chunk boundary and both terminators', () => {
  for (const end of ['\x07', '\x1b\\']) {
    const sequence = '\x1b]9;4;3' + end;
    for (let split = 0; split <= sequence.length; split++) {
      const tracker = new ActivityTracker(() => {});
      tracker.output(sequence.slice(0, split)); tracker.output(sequence.slice(split));
      assert.equal(tracker.state.busy, true, `split ${split}`);
      tracker.output('\x1b]9;4;0' + end);
      assert.equal(tracker.state.busy, false);
    }
  }
});
test('silent foreground work remains busy until a prompt or explicit completion', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.output('\x1b]133;B\x07'); tracker.input('Start-Sleep 5\r');
  assert.equal(tracker.state.busy, true);
  tracker.output('plain output'); tracker.output('');
  assert.equal(tracker.state.busy, true);
  tracker.output('\x1b]133;D;0\x07');
  assert.equal(tracker.state.busy, false);
});
test('native progress pauses, errors, and resumes are independent of shell lifetime', () => {
  const tracker = new ActivityTracker(() => {});
  for (const [mode, busy, kind] of [[3, true, 'reported'], [4, false, 'paused'], [1, true, 'reported'], [2, false, 'error'], [0, false, 'reported']]) {
    tracker.output(`\x1b]9;4;${mode};25\x07`);
    assert.equal(tracker.state.busy, busy); assert.equal(tracker.state.kind, kind);
  }
});
test('unrelated title and output do not pretend to indicate agent progress', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.output('\x1b]0;title\x07hello');
  assert.equal(tracker.state.busy, false);
  tracker.output('\x1b]' + 'x'.repeat(10000));
  assert.equal(tracker.pending.length, 0);
});
test('real Codex OSC 7501 lifecycle survives all chunk boundaries', () => {
  for (const end of ['\x07', '\x1b\\']) {
    for (const state of ['idle', 'working', 'done', 'blocked', 'error', 'clear']) {
      const sequence = `\x1b]7501;state=${state}:app=codex${end}`;
      for (let split = 0; split <= sequence.length; split++) {
        const tracker = new ActivityTracker(() => {});
        tracker.output(sequence.slice(0, split)); tracker.output(sequence.slice(split));
        assert.equal(tracker.state.busy, state === 'working', `${state} split ${split}`);
        assert.equal(tracker.state.kind, `agent-${state}`);
      }
    }
  }
});
test('Codex can finish, wait, and start another turn without exiting', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.output('\x1b]133;B\x07'); tracker.input('codex\r');
  assert.equal(tracker.state.busy, true);
  for (const [state, busy] of [['idle', false], ['working', true], ['done', false], ['idle', false], ['working', true], ['blocked:kind=permission', false], ['working', true], ['done', false]]) {
    tracker.output(`\x1b]7501;state=${state}:app=codex\x1b\\`);
    assert.equal(tracker.state.busy, busy, state);
  }
  tracker.output('\x1b]9;4;3\x07');
  assert.equal(tracker.state.busy, false, 'stale generic progress cannot override completed lifecycle');
});
