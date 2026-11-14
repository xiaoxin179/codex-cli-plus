const path = require('node:path');
function directoryKey(value) {
  if (!value) return '';
  if (/^[a-z]:[\\/]|^\\\\/i.test(value)) return path.win32.normalize(value.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '').toLowerCase();
  return path.posix.normalize(value).replace(/\/$/, '') || '/';
}
function normalize(tree, profiles) {
  const old = new Map((Array.isArray(tree) ? tree : []).map(n => [n.id, n]));
  const groups = new Map(), nodes = [];
  for (const profile of profiles) {
    const directory = profile.cwd || profile.workspaceCwd || '';
    const key = directoryKey(directory), id = `workspace:${key || 'unassigned'}`;
    if (!groups.has(id)) {
      const name = directory ? (path.win32.basename(directory.replace(/[\\/]+$/, '')) || directory) : '待归类';
      groups.set(id, { id, type: 'group', parent: 'root', name, directory, collapsed: !!old.get(id)?.collapsed });
    }
    nodes.push({ id: profile.id, type: 'profile', parent: id });
  }
  const order = new Map((Array.isArray(tree) ? tree : []).map((n, i) => [n.id, i]));
  const compare = (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity);
  return [...[...groups.values()].sort(compare), ...nodes.sort(compare)];
}
function change(tree, profiles, input) {
  const nodes = normalize(tree, profiles), node = nodes.find(n => n.id === input.id);
  if (!node) throw new Error('节点已更新，请重试');
  if (input.action === 'toggle' && node.type === 'group') node.collapsed = !!input.collapsed;
  else if (input.action === 'move') {
    const target = nodes.find(n => n.id === input.target);
    if (!target || target.id === node.id || target.parent !== node.parent || target.type !== node.type || !['before', 'after'].includes(input.position)) {
      throw new Error('会话按工作目录归类，只能在同一工作空间内排序；请编辑会话的工作目录来更改归属。');
    }
    nodes.splice(nodes.indexOf(node), 1);
    nodes.splice(nodes.indexOf(target) + (input.position === 'after' ? 1 : 0), 0, node);
  } else throw new Error('工作空间由项目目录自动生成，不支持手动分组。');
  return nodes;
}
module.exports = { normalize, change, directoryKey };
