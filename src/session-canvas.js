/* Mind-map view. Persistent hierarchy is owned by the main process. */
const sessionCanvas = (() => {
  const $ = id => document.getElementById(id);
  const canvas = $('tree-canvas'), world = $('tree-world');
  let view = { x: 40, y: 40, zoom: .85 }, bounds = { width: 650, height: 400 }, rootY = 0, firstRender = true;
  try { const saved = JSON.parse(localStorage.getItem('session-canvas-view')); if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)) view = { x: saved.x, y: saved.y, zoom: Math.max(.2, Math.min(1.6, saved.zoom)) }; } catch {}
  let dragging = null, pan = null;
  function transform() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    $('tree-zoom').textContent = `${Math.round(view.zoom * 100)}%`;
  }
  function persistView() { try { localStorage.setItem('session-canvas-view', JSON.stringify(view)); } catch {} }
  function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const next = Math.max(.2, Math.min(1.6, view.zoom * factor));
    view.x = x - (x - view.x) * next / view.zoom; view.y = y - (y - view.y) * next / view.zoom;
    view.zoom = next; transform(); persistView();
  }
  function fit() {
    if (!canvas.clientWidth) return;
    view.zoom = Math.max(.2, Math.min(1, (canvas.clientWidth - 80) / bounds.width, (canvas.clientHeight - 100) / bounds.height));
    view.x = (canvas.clientWidth - bounds.width * view.zoom) / 2;
    view.y = (canvas.clientHeight - bounds.height * view.zoom) / 2;
    transform(); persistView();
  }
  canvas.addEventListener('wheel', event => {
    event.preventDefault(); const rect = canvas.getBoundingClientRect();
    zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.tree-node, .canvas-controls')) return;
    pan = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('panning');
  });
  canvas.addEventListener('pointermove', event => {
    if (!pan) return;
    view.x = pan.vx + event.clientX - pan.x; view.y = pan.vy + event.clientY - pan.y; transform();
  });
  function endPan() { pan = null; canvas.classList.remove('panning'); persistView(); }
  canvas.addEventListener('pointerup', endPan); canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('lostpointercapture', endPan);
  canvas.addEventListener('keydown', event => {
    if (event.target !== canvas) return;
    const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) { event.preventDefault(); view.x += moves[event.key][0]; view.y += moves[event.key][1]; transform(); persistView(); }
    if (event.key === '0') fit();
  });
  $('tree-minus').onclick = () => zoom(1 / 1.2); $('tree-plus').onclick = () => zoom(1.2);
  $('tree-fit').onclick = fit;
  function centerRoot() { view = { x: 40, y: canvas.clientHeight / 2 - (rootY + 55) * .85, zoom: .85 }; transform(); persistView(); }
  $('tree-reset').onclick = centerRoot;
  function action(input) { return window.desktop.changeTree(input); }
  function control(text, title, callback) {
    const b = document.createElement('button'); b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
    b.onclick = () => Promise.resolve().then(callback).catch(error => { $('status').textContent = error.message; });
    return b;
  }
  function clearDrag() {
    dragging = null;
    for (const el of canvas.querySelectorAll('.tree-node')) el.classList.remove('dragging', 'drop-inside', 'drop-before', 'drop-after');
  }
  function wireDrag(el, node) {
    el.draggable = node.id !== 'root';
    let controlDown = false;
    el.addEventListener('mousedown', e => { controlDown = !!e.target.closest('button, input'); });
    el.addEventListener('dragstart', e => {
      if (controlDown) { e.preventDefault(); return; }
      dragging = node.id; e.dataTransfer.setData('text/plain', node.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging');
    });
    function position(e) {
      if (node.id === 'root') return 'inside';
      const rect = el.getBoundingClientRect(), fraction = (e.clientY - rect.top) / rect.height;
      return fraction < .5 ? 'before' : 'after';
    }
    el.addEventListener('dragover', e => {
      if (!dragging || dragging === node.id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      for (const other of canvas.querySelectorAll('.tree-node')) other.classList.remove('drop-inside', 'drop-before', 'drop-after');
      el.classList.add(`drop-${position(e)}`);
    });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-inside', 'drop-before', 'drop-after'); });
    el.addEventListener('drop', async e => {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      const input = { action: 'move', id: dragging, target: node.id, position: position(e) }; clearDrag();
      try { await action(input); } catch (error) { $('status').textContent = error.message; }
    });
    el.addEventListener('dragend', clearDrag);
  }
  function render(settings, cards) {
    clearDrag();
    const nodes = settings.tree || [];
    const children = new Map();
    for (const node of nodes) { if (!children.has(node.parent)) children.set(node.parent, []); children.get(node.parent).push(node); }
    const query = $('profile-search').value.trim().toLocaleLowerCase();
    const matched = new Set();
    const profiles = new Map(settings.profiles.map(p => [p.id, p]));
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) {
      const p = profiles.get(node.id);
      if (!query || [node.type === 'group' ? node.name : p?.name, node.directory, p?.workspaceCwd, p?.cwd, p?.command, p?.sessionId].some(v => v?.toLocaleLowerCase().includes(query))) {
        let current = node;
        while (current && !matched.has(current.id)) { matched.add(current.id); current = byId.get(current.parent); }
        if (node.type === 'group') {
          const queue = [...(children.get(node.id) || [])];
          while (queue.length) { const child = queue.pop(); matched.add(child.id); queue.push(...(children.get(child.id) || [])); }
        }
      }
    }
    $('search-empty').hidden = !query || matched.size > 0;
    const root = { id: 'root', name: '工作空间', type: 'group' };
    const positions = [], links = [];
    let cursor = 0, maxX = 0;
    function layout(node, depth) {
      const start = cursor, height = 110;
      const kids = (children.get(node.id) || []).filter(n => matched.has(n.id));
      const visible = query || !node.collapsed ? kids : [];
      const childPositions = visible.map(child => layout(child, depth + 1));
      if (!visible.length) cursor += height + 28;
      const y = visible.length ? (start + cursor - 28 - height) / 2 : start;
      const pos = { node, x: depth * 370, y, height, count: kids.length }; positions.push(pos);
      maxX = Math.max(maxX, pos.x + 290);
      for (const child of childPositions) links.push([pos, child]);
      return pos;
    }
    rootY = layout(root, 0).y; bounds = { width: maxX, height: Math.max(120, cursor - 28) };
    const container = $('profiles'); container.replaceChildren();
    for (const pos of positions) {
      const { node } = pos;
      let el = cards.get(node.id);
      if (!el) {
        el = document.createElement('article'); el.className = 'tree-group';
        const heading = document.createElement('div'); heading.className = 'group-title';
        const title = document.createElement('strong'); title.textContent = node.name; title.title = node.name;
        if (node.id !== 'root') {
          const toggle = control(node.collapsed && !query ? '▸' : '▾', `${node.collapsed ? '展开' : '收起'} ${node.name}`, () => action({ action: 'toggle', id: node.id, collapsed: !node.collapsed }));
          toggle.setAttribute('aria-expanded', String(!!query || !node.collapsed)); heading.append(toggle);
        }
        heading.append(title); el.append(heading);
        const actions = document.createElement('div'); actions.className = 'group-actions';
        const count = document.createElement('span');
        count.textContent = node.id === 'root' ? `${nodes.filter(n => n.type === 'group').length} 个工作空间 · ${settings.profiles.length} 个会话` : `${pos.count} 个会话`;
        actions.append(count);
        if (node.id !== 'root') {
          const directory = document.createElement('div'); directory.className = 'workspace-path';
          directory.textContent = node.directory || '未找到目录，请编辑会话手动指定'; directory.title = directory.textContent;
          el.append(directory);
        }
        el.append(actions);
      }
      el.classList.add('tree-node'); el.dataset.nodeId = node.id;
      el.style.left = `${pos.x}px`; el.style.top = `${pos.y}px`; el.style.height = `${pos.height}px`;
      wireDrag(el, node); container.append(el);
    }
    const svg = $('tree-links'); svg.replaceChildren(); svg.setAttribute('width', bounds.width); svg.setAttribute('height', bounds.height);
    for (const [from, to] of links) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x = from.x + 290, y = from.y + from.height / 2, targetY = to.y + to.height / 2;
      path.setAttribute('d', `M ${x} ${y} C ${x + 40} ${y}, ${to.x - 40} ${targetY}, ${to.x} ${targetY}`); svg.append(path);
    }
    transform();
    if (query) requestAnimationFrame(fit);
    else if (firstRender) {
      firstRender = false;
      let saved = false; try { saved = !!localStorage.getItem('session-canvas-view'); } catch {}
      if (!saved) requestAnimationFrame(centerRoot);
    }
  }
  return { render, fit };
})();
