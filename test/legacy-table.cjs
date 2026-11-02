// Run the exact same two-axis recycling fixture against the VXE 3 container.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'table-discovery.cjs');
const source=fs.readFileSync(file,'utf8').replaceAll('vxe-table--body-inner-wrapper','vxe-table--body-wrapper');
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=module.paths;
fixture._compile(source,file);
