'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function dataRoot(){const {app}=require('electron');return app?.isPackaged?app.getPath('userData'):path.join(__dirname,'..');}
function tasksDir() { return path.join(dataRoot(), 'tasks'); }
function resultsDir() { return path.join(dataRoot(), 'results'); }

function hostKey(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '_');
  } catch (e) { return 'unknown'; }
}

function taskFile(id, archived = false) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(id) || id === '.' || id === '..') throw Error('任务编号无效');
  return path.join(tasksDir(), archived ? 'archive' : '', id + '.json');
}
function saveTask(cfg) {
  try {
    if (!cfg || !cfg.url) return false;
    cfg.id ||= randomUUID();
    cfg.name ||= new URL(cfg.url).hostname;
    cfg.updatedAt = new Date().toISOString();
    const file = taskFile(cfg.id);
    fs.mkdirSync(tasksDir(), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(file + '.tmp', file);
    return true;
  } catch (error) { return false; }
}
function listTasks(archived = false) {
  const dir = path.join(tasksDir(), archived ? 'archive' : '');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!cfg.url) return [];
      return [{ id: name.slice(0,-5), name: cfg.name || hostKey(cfg.url), group: cfg.group || '', url: cfg.url, updatedAt: cfg.updatedAt || '' }];
    } catch (error) { return []; }
  }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
function getTask(id, archived = false) {
  const cfg = JSON.parse(fs.readFileSync(taskFile(id, archived), 'utf8'));
  return { ...cfg, id };
}
function archiveTask(id, restore = false) {
  const source = taskFile(id, restore), target = taskFile(id, !restore);
  if (fs.existsSync(target)) throw Error('目标任务已存在，无法覆盖');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}
function loadTask(url) {
  // 同一站点允许多个任务；优先精确 URL，旧站点文件仅作兼容回退。
  const exact = listTasks().find(task => task.url === url);
  if (exact) return getTask(exact.id);
  const legacy = path.join(tasksDir(), hostKey(url) + '.json');
  if (fs.existsSync(legacy)) return getTask(hostKey(url));
  return null;
}
function deleteArchivedTask(id) {
  fs.unlinkSync(taskFile(id, true));
}
module.exports = { tasksDir, resultsDir, saveTask, loadTask, listTasks, getTask, archiveTask, deleteArchivedTask };

function listGroups(){const file=path.join(tasksDir(),'groups.json');return [...new Set([...(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[]),...listTasks().map(t=>t.group),...listTasks(true).map(t=>t.group)].filter(Boolean))];}
function addGroup(name){name=String(name||'').trim();if(!name)throw Error('请输入分组名称');const groups=listGroups();if(!groups.includes(name))groups.push(name);fs.mkdirSync(tasksDir(),{recursive:true});fs.writeFileSync(path.join(tasksDir(),'groups.json'),JSON.stringify(groups));return groups;}
function updateTaskMeta(id,archived,changes){const cfg=getTask(id,archived);if(changes.name!==undefined){const name=String(changes.name).trim();if(!name)throw Error('请输入任务名称');cfg.name=name;}if(changes.group!==undefined){cfg.group=String(changes.group).trim();if(cfg.group)addGroup(cfg.group);}cfg.updatedAt=new Date().toISOString();const file=taskFile(id,archived);fs.writeFileSync(file+'.tmp',JSON.stringify(cfg,null,2));fs.renameSync(file+'.tmp',file);return cfg;}
function deleteTask(id,archived){fs.unlinkSync(taskFile(id,archived));}
Object.assign(module.exports,{listGroups,addGroup,updateTaskMeta,deleteTask});

function deleteGroup(name,deleteTasks=false){
  if(!name||!listGroups().includes(name))throw Error('分组不存在');
  const groups=listGroups().filter(g=>g!==name),affected=[];
  for(const archived of [false,true])for(const task of listTasks(archived).filter(t=>t.group===name)){
    if(deleteTasks)deleteTask(task.id,archived);else updateTaskMeta(task.id,archived,{group:''});
    affected.push(task.id);
  }
  const file=path.join(tasksDir(),'groups.json');fs.writeFileSync(file+'.tmp',JSON.stringify(groups));fs.renameSync(file+'.tmp',file);
  return affected;
}
module.exports.deleteGroup=deleteGroup;

function renameGroup(oldName,newName){
  newName=String(newName||'').trim();const groups=listGroups();
  if(!groups.includes(oldName))throw Error('分组不存在');
  if(!newName)throw Error('请输入分组名称');
  if(oldName===newName)return newName;
  if(groups.includes(newName))throw Error('分组名称已存在');
  for(const archived of [false,true])for(const task of listTasks(archived).filter(t=>t.group===oldName))updateTaskMeta(task.id,archived,{group:newName});
  const file=path.join(tasksDir(),'groups.json');fs.writeFileSync(file+'.tmp',JSON.stringify(groups.map(g=>g===oldName?newName:g)));fs.renameSync(file+'.tmp',file);return newName;
}
module.exports.renameGroup=renameGroup;
