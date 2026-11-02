const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),code=require('../engine/pagecode');
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});try{
 await w.loadURL('data:text/html,<div class="catalog"><div><div class="product"><b class="title">A</b></div></div><a class="product"><i>badge</i><b class="title">B</b></a><a class="product"><b class="title">C</b></a></div>');
 const exec=(fn,...args)=>w.webContents.executeJavaScript(`(${fn})(${args.map(x=>JSON.stringify(x)).join(',')})`);
 const picked=await exec(code.resolvePickCode(),'.catalog > div > .product','list',{});
 assert.equal(picked.count,3);assert.equal(picked.list.selector,'.catalog .product');
 const field=await exec(code.resolvePickCode(),'.catalog > div .title','extract-text',{list:picked.list,fields:[]});
 assert.equal(field.fields[0].rel,'.title');assert.deepEqual(field.samples,[['A'],['B'],['C']]);
 await w.webContents.executeJavaScript(`document.querySelector('.catalog').innerHTML='<a class="product"><b class="title">D</b></a><div class="product"><b class="title">E</b></div>'`);
 const preview=await exec(code.previewCode(),{list:picked.list,fields:field.fields});assert.deepEqual(preview.rows,[['D'],['E']]);
 const old={list:{type:'css',selector:'.catalog > div > a > div.product'},fields:field.fields};
 const suggestion=await exec(code.suggestListCode(),old);assert.equal(suggestion.count,2);assert.equal(old.list.selector,'.catalog > div > a > div.product');assert.deepEqual(suggestion.samples,[['D'],['E']]);
 console.log('PASS: mixed a/div cards, wrapper changes, badge offsets, relative fields, non-mutating repair candidate preview');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}});
