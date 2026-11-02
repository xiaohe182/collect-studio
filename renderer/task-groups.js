let taskFormAction=null,contextTask=null,contextGroup=null;
function renderTaskGroups(){
  const host=$('taskGroupTabs');host.replaceChildren();
  for(const [name,group] of [['全部',null],['未分组',''],...taskGroups.map(g=>[g,g])]){
    const button=document.createElement('button');button.className='mini task-group-tab';button.textContent=name;button.classList.toggle('active',activeTaskGroup===group);
    if(group)button.oncontextmenu=e=>{
      e.preventDefault();contextGroup=group;$('taskContext').hidden=true;
      const menu=$('groupContext'),rect=$('tasksDialog').getBoundingClientRect();menu.hidden=false;
      menu.style.left=Math.max(8,Math.min(e.clientX-rect.left,rect.width-190))+'px';menu.style.top=Math.max(8,e.clientY-rect.top)+'px';
    };
    button.onclick=()=>{activeTaskGroup=group;selectedTaskIds.clear();renderTaskGroups();renderTasks();};
    if(group!==null){button.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-task-id')){e.preventDefault();e.dataTransfer.dropEffect='move';button.classList.add('drop-target');}};button.ondragleave=()=>button.classList.remove('drop-target');button.ondrop=async e=>{
      e.preventDefault();button.classList.remove('drop-target');const id=e.dataTransfer.getData('application/x-task-id');if(!taskEntries.some(t=>t.id===id)||scraping||batchTaskBusy)return;
      const r=await cmd('task-meta',{id,archived:false,changes:{group}});
      if(r.ok){if(cfg.id===id){cfg.group=group;$('taskGroup').value=group;}toast('已移入'+(group||'未分组'));await refreshTasks();}else toast(r.error);
    };}host.append(button);
  }
}
function openTaskNameForm(action,task){
  taskFormAction={action,task};$('taskContext').hidden=true;$('groupContext').hidden=true;
  $('taskFormTitle').textContent={task:'新建任务',group:'新建分组',rename:'重命名任务',renameGroup:'重命名分组'}[action];
  $('taskFormName').value=task?.name||'';$('taskFormGroup').replaceChildren();
  for(const group of ['',...taskGroups])$('taskFormGroup').add(new Option(group||'未分组',group));
  $('taskFormGroup').value=activeTaskGroup||'';$('taskFormGroup').hidden=action!=='task';
  $('taskNameForm').hidden=false;$('taskFormName').focus();
}
$('btnNewTask').onclick=()=>openTaskNameForm('task');
$('btnNewGroup').onclick=()=>openTaskNameForm('group');
$('taskFormCancel').onclick=()=>{$('taskNameForm').hidden=true;taskFormAction=null;};
$('taskNameForm').onsubmit=async e=>{
  e.preventDefault();if(!taskFormAction||scraping||batchTaskBusy)return;
  const name=$('taskFormName').value.trim();if(!name)return;
  const {action,task}=taskFormAction;let result;
  if(action==='group'){result=await cmd('task-group-create',{name});if(result.ok)activeTaskGroup=name;}
  else if(action==='renameGroup'){
    result=await cmd('task-group-rename',{oldName:task.name,name});
    if(result.ok){if(activeTaskGroup===task.name)activeTaskGroup=result.name;if(cfg.group===task.name){cfg.group=result.name;$('taskGroup').value=result.name;}}
  }
  else if(action==='rename'){
    result=await cmd('task-meta',{id:task.id,archived:false,changes:{name}});
    if(result.ok&&cfg.id===task.id){cfg.name=name;$('taskName').value=name;}
  }else{
    if(!await saveCurrentTask(true))return;
    result=await cmd('task-create-named',{name,group:$('taskFormGroup').value});
    if(result.ok){await cmd('task-new');settingsDirty=false;loadEditor(result.cfg);syncSaveState();$('tasksDialog').close();}
  }
  if(!result.ok){toast(result.error||'操作失败');return;}
  $('taskNameForm').hidden=true;$('taskFormName').value='';$('taskFormGroup').value='';taskFormAction=null;await refreshTasks();toast(action.startsWith('rename')?'已重命名':'创建成功');
};
function showTaskContext(task,e){
  contextTask=task;const menu=$('taskContext');menu.hidden=false;
  const rect=$('tasksDialog').getBoundingClientRect();menu.style.left=Math.max(8,Math.min(e.clientX-rect.left,rect.width-160))+'px';menu.style.top=Math.max(8,Math.min(e.clientY-rect.top,rect.height-112))+'px';
}
$('taskRename').onclick=()=>{if(contextTask)openTaskNameForm('rename',contextTask);};
$('taskDelete').onclick=async()=>{
  const task=contextTask;$('taskContext').hidden=true;if(!task)return;
  const result=await cmd('task-delete',{id:task.id,archived:false});
  if(!result.ok){toast(result.error);return;}if(result.cancelled)return;
  selectedTaskIds.delete(task.id);
  if(cfg.id===task.id){await cmd('task-new');settingsDirty=false;loadEditor({});syncSaveState();}
  await refreshTasks();toast('任务已删除');
};
$('tasksDialog').addEventListener('click',e=>{if(!e.target.closest('#taskContext'))$('taskContext').hidden=true;});
$('tasksDialog').addEventListener('close',()=>{$('taskContext').hidden=true;$('taskNameForm').hidden=true;});

$('groupDelete').onclick=async()=>{
  const name=contextGroup;$('groupContext').hidden=true;if(!name||batchTaskBusy||scraping)return;
  batchTaskBusy=true;updateTaskSelection();
  try{
    const r=await cmd('task-group-delete',{name});if(!r.ok){toast(r.error);return;}if(r.cancelled)return;
    if(cfg.group===name){
      if(r.deletedTasks){await cmd('task-new');settingsDirty=false;loadEditor({});syncSaveState();}
      else{cfg.group='';$('taskGroup').value='';}
    }
    if(activeTaskGroup===name)activeTaskGroup='';selectedTaskIds.clear();toast(r.deletedTasks?'分组及组内任务已删除':'分组已删除，任务已移至未分组');
  }finally{batchTaskBusy=false;await refreshTasks();}
};
$('tasksDialog').addEventListener('click',e=>{if(!e.target.closest('#groupContext'))$('groupContext').hidden=true;});
$('tasksDialog').addEventListener('close',()=>{$('groupContext').hidden=true;});

$('groupRename').onclick=()=>{if(contextGroup)openTaskNameForm('renameGroup',{name:contextGroup});};

$('taskExportPng').onclick=async()=>{
  const task=contextTask;if(!task)return;$('taskContext').hidden=true;
  const button=$('taskExportPng');if(button.disabled)return;button.disabled=true;
  try{toast('正在导出已保存的完整流程…');const r=await cmd('task-export-png',{id:task.id});if(!r.ok)toast(r.error||'导出失败');else if(!r.cancelled)toast('流程 PNG 已导出：'+r.path);}
  finally{button.disabled=false;}
};
