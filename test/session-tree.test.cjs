const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, change } = require('../src/session-tree.cjs');
const profiles = [{id:'a', workspaceCwd:'C:\\code\\project'}, {id:'b', workspaceCwd:'c:/code/project/'}, {id:'c',cwd:'D:\\code\\project'}, {id:'d'}];
test('fixed workspaces merge equivalent Windows paths and keep same-name projects separate', () => {
 const tree=normalize([{id:'old',type:'group',parent:'root'},{id:'a',parent:'old'}],profiles);
 assert.equal(tree.filter(n=>n.type==='group').length,3);
 assert.equal(tree.find(n=>n.id==='a').parent,tree.find(n=>n.id==='b').parent);
 assert.notEqual(tree.find(n=>n.id==='a').parent,tree.find(n=>n.id==='c').parent);
 assert.equal(tree.find(n=>n.id==='d').parent,'workspace:unassigned');
 assert.equal(tree.some(n=>n.id==='old'),false);
 assert.equal(tree.filter(n=>n.type==='profile').length,4);
});
test('collapse and same-workspace order survive refresh; cross-project moves are rejected', () => {
 let tree=normalize([],profiles), group=tree.find(n=>n.id==='a').parent;
 tree=change(tree,profiles,{action:'toggle',id:group,collapsed:true});
 tree=change(tree,profiles,{action:'move',id:'b',target:'a',position:'before'});
 tree=normalize(tree,profiles);
 assert.equal(tree.find(n=>n.id===group).collapsed,true);
 assert.deepEqual(tree.filter(n=>n.parent===group).map(n=>n.id),['b','a']);
 assert.throws(()=>change(tree,profiles,{action:'move',id:'a',target:'c',position:'before'}));
 assert.throws(()=>change(tree,profiles,{action:'add',id:group,name:'nested'}));
 const moved=normalize(tree,profiles.map(p=>p.id==='a'?{...p,cwd:'D:\\code\\project'}:p));
 assert.equal(moved.find(n=>n.id==='a').parent,moved.find(n=>n.id==='c').parent);
});
