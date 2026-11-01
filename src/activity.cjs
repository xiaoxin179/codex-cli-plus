// Incremental OSC parser; sequences can span several PTY output chunks.
class ActivityTracker {
  constructor(onChange) {
    this.onChange = onChange;
    this.pending = '';
    this.ready = false;
    this.programReported = false;
    this.state = { busy: false, kind: 'starting', label: '启动中' };
  }
  set(busy, kind, label) {
    const state = { busy, kind, label };
    if (JSON.stringify(state) !== JSON.stringify(this.state)) {
      this.state = state;
      this.onChange(state);
    }
  }
  input(data) {
    if (this.ready && /[\r\n]/.test(data)) {
      this.ready = false;
      this.programReported = false;
      this.set(true, 'foreground', '程序运行中');
    }
  }
  osc(body) {
    if (body.startsWith('7501;')) {
      const fields = Object.fromEntries(body.slice(5).split(':').map(field => {
        const separator = field.indexOf('=');
        return separator < 0 ? [field, ''] : [field.slice(0, separator), field.slice(separator + 1)];
      }));
      const labels = { idle: '等待输入', working: '工作中', done: '已完成', error: '运行失败', clear: '已停止', blocked: { permission: '等待授权', question: '等待回答', auth: '等待登录' }[fields.kind] || '等待输入' };
      if (!Object.hasOwn(labels, fields.state)) return;
      this.ready = false;
      this.programReported = fields.state !== 'clear';
      this.set(fields.state === 'working', `agent-${fields.state}`, labels[fields.state]);
    } else if (body === '133;A' || body === '133;B' || /^133;D(?:;|$)/.test(body)) {
      this.ready = true;
      this.programReported = false;
      this.set(false, 'prompt', '等待命令');
    } else if (body === '133;C') {
      this.ready = false;
      this.programReported = false;
      this.set(true, 'foreground', '程序运行中');
    } else if (body.startsWith('9;4;')) {
      // Explicit lifecycle state takes precedence over generic progress bars.
      if (this.programReported) return;
      const mode = Number(body.split(';')[2]);
      if (mode === 0) this.set(false, 'reported', '等待输入 / 已完成');
      if (mode === 1 || mode === 3) this.set(true, 'reported', '工作中');
      if (mode === 2) this.set(false, 'error', '程序报告错误');
      if (mode === 4) this.set(false, 'paused', '已暂停');
    }
  }
  output(data) {
    const text = this.pending + data;
    this.pending = '';
    let index = 0;
    while (index < text.length) {
      const start = text.indexOf('\x1b]', index);
      if (start < 0) {
        if (text.endsWith('\x1b')) this.pending = '\x1b';
        break;
      }
      const bel = text.indexOf('\x07', start + 2);
      const st = text.indexOf('\x1b\\', start + 2);
      const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
      if (end < 0) {
        if (text.length - start < 8192) this.pending = text.slice(start);
        break;
      }
      this.osc(text.slice(start + 2, end));
      index = end + (end === st ? 2 : 1);
    }
  }
}
module.exports = { ActivityTracker };
