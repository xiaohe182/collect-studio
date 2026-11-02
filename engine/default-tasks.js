'use strict';
const fs=require('fs'),path=require('path'),{createHash}=require('crypto');
function fingerprint(task){const copy=structuredClone(task);delete copy.updatedAt;return createHash('sha256').update(JSON.stringify(copy)).digest('hex');}
function installDefaultTasks(storage){
  const dir=storage.tasksDir(),marker=path.join(dir,'default-tasks-installed.json');
  const saved=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):{};
  const installed=Array.isArray(saved)?Object.fromEntries(saved.map(id=>[id,null])):saved;
  const legacy=require('./default-task-legacy-hashes.json');
  const templates=JSON.parse(fs.readFileSync(path.join(__dirname,'default-tasks.json'),'utf8'));
  for(const task of templates){
    const file=path.join(dir,task.id+'.json'),exists=fs.existsSync(file),known=Object.hasOwn(installed,task.id);
    const previous=installed[task.id]||legacy[task.id];
    // Upgrade untouched shipped flows; preserve edits, archived flows, and deletions.
    const upgrade=exists&&previous&&fingerprint(JSON.parse(fs.readFileSync(file,'utf8')))===previous;
    if((!known&&!exists)||(upgrade&&fingerprint(task)!==previous)){
      if(!storage.saveTask(structuredClone(task)))throw Error('默认流程保存失败：'+task.name);
    }
    installed[task.id]=fingerprint(task);
  }
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(marker+'.tmp',JSON.stringify(installed));fs.renameSync(marker+'.tmp',marker);
}
module.exports={installDefaultTasks};
