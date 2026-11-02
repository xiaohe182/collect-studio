const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http');
const {Scraper}=require('../engine/orchestrator'),W=require('../engine/workflow');
app.setPath('userData',require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'v6-parity-')));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<body><select id="sort"><option value="a">默认</option><option value="b">价格</option></select><div id="items"></div><button id="more">更多</button><script>let n=0;function add(){for(let i=0;i<3;i++){n++;let el=document.createElement('article');el.innerHTML='<h3>商品'+n+'</h3><span>'+n+'</span>';document.querySelector('#items').append(el);}if(n===9)document.querySelector('#more').remove();}add();document.querySelector('#more').onclick=add;</script></body>`);});
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 const extract=W.node('extract');extract.params.triggers=[{groups:[[{field:'价格',op:'lt',value:'3'}]]}];
 const list=W.node('list');list.children=[extract];const more=W.node('loadMore');more.params={selector:'#more',count:10,seconds:0};more.children=[list];
 const select=W.node('select');select.params={selector:'#sort',value:'b'};const condition=W.node('condition');condition.params={selector:'#items',operator:'exists'};condition.children=[more];
 const missing=W.node('click');missing.params={selector:'#absent',timeout:.02,retries:1,onError:'continue'};
 let rows=[],done,errors=[],logs=[];
 const scraper=new Scraper(win,{cfg:{url,list:{type:'css',selector:'article'},fields:[{name:'名称',type:'text',rel:'h3'},{name:'价格',type:'text',rel:'span'}],flow:[W.node('open'),select,missing,condition]},opts:{scrollLoad:false},onRows:r=>rows.push(...r),onDone:r=>done=r,onError:e=>errors.push(e),onLog:l=>logs.push(l)});
 await scraper.run();assert.deepEqual(errors,[]);assert.deepEqual(rows.map(r=>r[1]),['3','4','5','6','7','8','9']);assert.equal(done.duplicates,5);assert.equal(done.filtered,6);assert.equal(await win.webContents.executeJavaScript("document.querySelector('#sort').value"),'b');assert.ok(logs.some(l=>l.includes('重试')));assert.ok(logs.some(l=>l.includes('跳过')));
 await win.webContents.executeJavaScript(`(()=>{document.body.innerHTML='<div id="area" style="height:100px;overflow:auto"><div id="items"></div></div>';let n=0;window.addRows=()=>{for(let i=0;i<3;i++){let el=document.createElement('article');el.style.height='80px';el.innerHTML='<h3>滚动'+(++n)+'</h3><span>'+n+'</span>';document.querySelector('#items').append(el);}};addRows();document.querySelector('#area').onscroll=()=>{if(n<9)addRows()};})()`);
 const scroll=W.node('scrollLoop');scroll.params={selector:'#area',count:10,seconds:1,bottom:true,stopUnchanged:true};const sl=W.node('list');sl.children=[W.node('extract')];scroll.children=[sl];rows=[];errors=[];
 const sc=new Scraper(win,{cfg:{list:{type:'css',selector:'article'},fields:[{name:'名称',type:'text',rel:'h3'}],flow:[scroll]},opts:{scrollLoad:false},onRows:r=>rows.push(...r),onError:e=>errors.push(e),onLog:console.log});await sc.run();console.log('SCROLL STATE',await win.webContents.executeJavaScript("JSON.stringify({top:document.querySelector('#area').scrollTop,height:document.querySelector('#area').scrollHeight,count:document.querySelectorAll('article').length})"));assert.deepEqual(errors,[]);assert.equal(rows.length,9);assert.equal(rows[0][0],'滚动1');assert.equal(rows[8][0],'滚动9');
 console.log('PASS: load more 9 source rows, exact 7 filtered rows, duplicates/stats, dropdown, condition, retry/continue; inner scroll 9 exact rows including first and last');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}finally{server.close();}
});
