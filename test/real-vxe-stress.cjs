// Run with V6_STRESS_NODE_MODULES pointing at an existing Vue/VXE installation.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {genericTable}=require('../engine/generic-table');
const deps=process.env.V6_STRESS_NODE_MODULES;
if(!deps)throw Error('Set V6_STRESS_NODE_MODULES to an existing Vue/VXE node_modules directory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-real-grid-'));
app.setPath('userData',path.join(root,'profile'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{backgroundThrottling:false}});
 try{
  const asset=p=>pathToFileURL(path.join(deps,p)).href;
  const html=`<!doctype html><meta charset="utf-8">
  <link rel="stylesheet" href="${asset('vxe-pc-ui/lib/style.css')}"><link rel="stylesheet" href="${asset('vxe-table/lib/style.css')}">
  <script src="${asset('vue/dist/vue.global.prod.js')}"></script><script src="${asset('xe-utils/dist/xe-utils.umd.js')}"></script>
  <script src="${asset('vxe-pc-ui/lib/index.umd.js')}"></script><script src="${asset('vxe-table/lib/index.umd.js')}"></script>
  <div id="app"><vxe-grid ref="grid" v-bind="options"></vxe-grid></div><script>
  window.count=Number(new URLSearchParams(location.search).get('rows')||100);
  window.widths=Number(new URLSearchParams(location.search).get('cols')||12);
  const columns=[{type:'checkbox',width:50,fixed:'left'},{type:'seq',title:'序号',width:60,fixed:'left'},...Array.from({length:widths},(_,c)=>({field:'c'+c,title:'业务列'+c,width:150})),{field:'end',title:'末列',width:100,fixed:'right'}];
  const data=Array.from({length:count},(_,r)=>({id:'row'+r,...Object.fromEntries(Array.from({length:widths},(_,c)=>['c'+c,(r+c)%17===0?'':'R'+r+'C'+c])),end:'END'+r}));
  window.vm=Vue.createApp({data:()=>({options:{border:true,height:360,showOverflow:true,rowConfig:{keyField:'id',height:36},scrollX:{enabled:true,gt:0},scrollY:{enabled:true,gt:0},columns,data}})}).use(VxeUI).use(VxeUITable).mount('#app');
  </script>`;
  fs.writeFileSync(path.join(root,'grid.html'),html);
  await w.loadURL(pathToFileURL(path.join(root,'grid.html')).href+'?rows='+(process.env.V6_STRESS_ROWS||100)+'&cols='+(process.env.V6_STRESS_COLS||12));
  const run=code=>w.webContents.executeJavaScript(code);
  for(let i=0;i<100;i++){if(await run('!!document.querySelector(".vxe-table--body td")'))break;await new Promise(r=>setTimeout(r,50));}
  console.log('VXE',JSON.parse(fs.readFileSync(path.join(deps,'vxe-table/package.json'))).version);
  console.log(await run(`JSON.stringify({rows:document.querySelectorAll('tr[rowid]').length,placeholder:document.querySelectorAll('.fixed--hidden').length,wrappers:[...document.querySelectorAll('.vxe-table--body-wrapper,.vxe-table--body-inner-wrapper')].map(e=>({class:e.className,w:e.clientWidth,sw:e.scrollWidth,h:e.clientHeight,sh:e.scrollHeight,overflow:getComputedStyle(e).overflow}))})`));
  const cfg=await run('('+genericTable.toString()+')(".vxe-table--main-wrapper td:not(.fixed--hidden)")');
  console.log('DISCOVERY',JSON.stringify(cfg.fields.map(f=>f.name)));
  const result=await run('('+genericTable.toString()+')('+JSON.stringify(cfg)+',{scrollWait:0,maxScrollSec:180})');
  const count=Number(process.env.V6_STRESS_ROWS||100),cols=Number(process.env.V6_STRESS_COLS||12);
  console.log('RESULT',JSON.stringify({reason:result.reason,rows:result.rows.length,cols:result.fields.length,rounds:result.rounds,ms:result.ms,incomplete:result.incomplete}));
  let wrong=0;
  for(let r=0;r<count;r++)for(let c=0;c<cols;c++){
   const index=result.fields.findIndex(f=>f.name==='业务列'+c),expected=(r+c)%17===0?'':'R'+r+'C'+c;
   if(result.rows[r]?.[index]!==expected)wrong++;
  }
  console.log('MISMATCHED_CELLS',wrong);
  assert.equal(wrong,0,'Every business cell must match, including legitimate empty cells');
  assert.equal(result.reason,'完成表格扫描');assert.equal(result.rows.length,count);
  assert.ok(!result.fields.some(f=>/^字段\d+$/.test(f.name)),'Checkbox must not become an unnamed field');
  assert.equal(result.fields.length,cols+2);
  assert.deepEqual(result.rows.map(r=>r[result.fields.findIndex(f=>f.name==='末列')]),Array.from({length:count},(_,r)=>'END'+r));
  console.log('PASS real VXE fixed copies + 2D recycled rows + checkbox + legitimate empty cells');
  app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
