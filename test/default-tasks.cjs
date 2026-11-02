const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {installDefaultTasks}=require('../engine/default-tasks');
const templates=require('../engine/default-tasks.json'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'default-flows-'));
const storage={tasksDir:()=>dir,saveTask:t=>{fs.writeFileSync(path.join(dir,t.id+'.json'),JSON.stringify(t));return true;}};
installDefaultTasks(storage);assert.equal(templates.length,6);
const first=path.join(dir,templates[0].id+'.json');fs.writeFileSync(first,'{"name":"user edit"}');
fs.unlinkSync(path.join(dir,templates[1].id+'.json'));installDefaultTasks(storage);
assert.equal(JSON.parse(fs.readFileSync(first)).name,'user edit');assert.ok(!fs.existsSync(path.join(dir,templates[1].id+'.json')));
for(const t of templates)require('../engine/workflow').validate(t.flow);
for(const t of templates){
 const source=require('../tasks/'+t.id.replace(/^default-/,'').replace(/-preview$/,'')+'.json');
 const inputs=nodes=>nodes.flatMap(n=>[...(['input','inputGroup'].includes(n.type)?[n.params]:[]),...inputs(n.children||[])]);
 assert.deepEqual(inputs(t.flow),inputs(source.flow),'saved login inputs retained');
}
const legacy=require('../engine/default-task-legacy-hashes.json');assert.equal(Object.keys(legacy).length,6);
console.log('PASS six valid defaults; preserve edits and deletions across restart');
