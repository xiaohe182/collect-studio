const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'table-discovery.cjs');
const source=fs.readFileSync(file,'utf8')
 .replace("{collectVirtualTable}=require('../engine/virtual-table')","{genericTable:collectVirtualTable}=require('../engine/generic-table')")
 .replace("require('../engine/table-discovery').discoverTable","require('../engine/generic-table').genericTable")
 .replace('detected.list.virtualGrid','detected.list.genericGrid')
 .replace('完成双向虚拟表格扫描','完成表格扫描');
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=module.paths;fixture._compile(source,file);
