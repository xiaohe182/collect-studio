const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),W=require('../engine/workflow'),{Scraper}=require('../engine/orchestrator');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 await win.loadURL('data:text/html,<article><h2>toy</h2><b>10</b></article><section class="sku">red</section><section class="sku">blue</section>');
 const products=W.node('list');products.params.list={type:'css',selector:'article'};const extract=W.node('extract');extract.params.fields=[{name:'title',rel:'h2',type:'text'},{name:'price',rel:'b',type:'text'}];products.children=[extract];
 const skus=W.node('list');skus.params.list={type:'css',selector:'.sku'};const sku=W.node('extract');sku.params.fields=[{name:'sku',rel:':scope',type:'text'}];skus.children=[sku];
 const cfg={flow:[products,skus],list:skus.params.list,fields:sku.params.fields};let rows=[],error;
 await new Scraper(win,{cfg,opts:{scrollLoad:false},onRows:r=>rows.push(...r),onError:e=>error=e}).run();
 assert.equal(error,undefined);assert.deepEqual(W.resultFields(cfg).map(f=>f.name),['title','price','sku']);assert.deepEqual(rows,[['toy','10',''],['','','red'],['','','blue']]);
 console.log('PASS: independent product and SKU selectors/fields, merged export columns without data contamination');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
