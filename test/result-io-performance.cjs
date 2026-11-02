'use strict';
// Synthetic rows only. A synchronous implementation must fail the heartbeat budget.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const exporter=require('../engine/exporter');
const ioFile=path.join(__dirname,'../engine/result-io.js');
const io=fs.existsSync(ioFile)?require(ioFile):{};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-result-io-'));
const fields=Array.from({length:8},(_,i)=>({name:'字段'+i}));
const rows=Array.from({length:32000},(_,i)=>Array.from({length:8},(_,j)=>j===0?String(i):'中文商品 '+i+'-'+j+' '+('内容'.repeat(12))));
const metrics=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function measure(name,fn){
  let last=performance.now(),maxGap=0,beats=0;
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},5);
  await delay(15);const start=performance.now();
  try{return await fn();}finally{await delay(15);clearInterval(timer);metrics.push({name,ms:Math.round(performance.now()-start),maxGap:Math.round(maxGap),beats});}
}
(async()=>{
  try{
    if(process.argv.includes('--baseline')){
      for(const format of ['csv','json','xlsx']){
        const result=await measure('sync '+format,()=>exporter.exportRows(rows,fields,format,root,'baseline'));
        assert.equal(result.ok,true,result.error);
      }
      const runFile=path.join(root,'large.json');fs.writeFileSync(runFile,JSON.stringify({fields,rows,logs:[],summary:{name:'synthetic'}}));
      await measure('sync history parse',()=>JSON.parse(fs.readFileSync(runFile,'utf8')));
      console.log(JSON.stringify({rows:rows.length,columns:fields.length,metrics}));return;
    }
    assert.equal(typeof exporter.exportRowsAsync,'function','large exports need a nonblocking async API');
    assert.equal(typeof io.readRunPage,'function','history needs worker-side pagination');
    for(const format of ['csv','json','xlsx']){
      const result=await measure('async '+format,()=>exporter.exportRowsAsync(rows,fields,format,root,'worker'));
      assert.equal(result.ok,true,result.error);assert.equal(result.count,32000);
      if(format==='json'){
        const parsed=JSON.parse(fs.readFileSync(result.path,'utf8'));
        assert.equal(parsed.length,32000);assert.equal(parsed[31999]['字段0'],'31999');
      }else if(format==='csv'){
        const text=fs.readFileSync(result.path,'utf8');assert.ok(text.startsWith('\ufeff字段0,'));assert.ok(text.includes('31999'));
      }else{
        const XLSX=require('xlsx'),wb=XLSX.readFile(result.path),sheet=wb.Sheets[wb.SheetNames[0]];
        assert.equal(sheet.A1.v,'字段0');assert.equal(sheet.A32001.v,'31999');
      }
    }
    // Repeated exports must keep both files, and JS special property names remain fields.
    const special=await exporter.exportRowsAsync([['first',0,false,'a,"b\n中']],[{name:'__proto__'},{name:'zero'},{name:'false'},{name:'text'}],'json',root,'special');
    const second=await exporter.exportRowsAsync([['second']],[{name:'__proto__'}],'json',root,'special');
    assert.notEqual(special.path,second.path);
    const specialRows=JSON.parse(fs.readFileSync(special.path,'utf8'));
    assert.deepEqual(specialRows,[JSON.parse('{"__proto__":"first","zero":0,"false":false,"text":"a,\\\"b\\n中"}')]);
    const runFolder=path.join(root,'runs');fs.mkdirSync(runFolder);
    const runFile=path.join(runFolder,'123.json');
    fs.writeFileSync(runFile,JSON.stringify({summary:{name:'synthetic',total:32000},fields,rows,logs:Array.from({length:600},(_,i)=>({time:String(i),message:'log '+i}))}));
    const page=await measure('async history first page',()=>io.readRunPage(runFile,1));
    assert.equal(page.total,32000);assert.equal(page.rows.length,100);assert.equal(page.rows[0][0],'100');assert.equal(page.pageSize,100);assert.equal(page.logs.length,500);assert.equal(page.logs[0].message,'log 100');
    const last=await io.readRunPage(runFile,99999);assert.equal(last.page,319);assert.equal(last.rows[99][0],'31999');
    const history=await io.listRunHistory(runFolder);assert.deepEqual(history,[{name:'synthetic',total:32000,id:'123'}]);
    const exported=await measure('async history export',()=>io.exportRunAsync(runFile,'csv',root,'history'));
    assert.equal(exported.ok,true,exported.error);assert.equal(exported.count,32000);
    const logFile=path.join(root,'logs.txt');assert.equal((await io.exportRunLogsAsync(runFile,logFile)).ok,true);assert.equal(fs.readFileSync(logFile,'utf8').split('\n').length,600);
    // Replacing a history file must invalidate the single-file worker cache.
    fs.writeFileSync(runFile,JSON.stringify({summary:{name:'replacement'},fields:[{name:'new'}],rows:[['fresh']],logs:[]}));
    assert.equal((await io.readRunPage(runFile,0)).rows[0][0],'fresh');
    await assert.rejects(io.readRunPage(path.join(root,'missing.json'),0),/ENOENT/);
    await assert.rejects(io.readJournalAsync(path.join(root,'missing.jsonl')),/ENOENT/);
    const failed=await exporter.exportRowsAsync([['x']],fields,'csv',path.join(root,'missing-dir'));assert.equal(failed.ok,false);assert.match(failed.error,/ENOENT/);
    const recovered=await exporter.exportRowsAsync([['after-error']],fields,'csv',root);assert.equal(recovered.ok,true,recovered.error);
    const journalFile=path.join(root,'synthetic.jsonl');
    const fd=fs.openSync(journalFile,'w');fs.writeSync(fd,JSON.stringify({type:'start',fields})+'\n');
    for(let i=0;i<rows.length;i+=1000)fs.writeSync(fd,JSON.stringify({type:'commit',rows:rows.slice(i,i+1000)})+'\n');
    fs.writeSync(fd,JSON.stringify({type:'preview',collection:'last',rows:[{id:'p',values:['pending']}]})+'\n');fs.writeSync(fd,'{"type":"commit","rows":');fs.closeSync(fd);
    const journal=await measure('async journal recovery',()=>io.readJournalAsync(journalFile));
    assert.equal(journal.rows.length,32001);assert.equal(journal.rows[31999][0],'31999');assert.deepEqual(journal.rows[32000],['pending']);
    for(const metric of metrics)assert.ok(metric.maxGap<150,metric.name+' blocked the main event loop for '+metric.maxGap+'ms');
    console.log(JSON.stringify({pass:true,rows:rows.length,columns:fields.length,metrics}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
