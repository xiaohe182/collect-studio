'use strict';
// Read a crash journal line by line; a torn final line must not discard earlier records.
async function readJournal(file){
  const fs=require('node:fs'),readline=require('node:readline');
  const rows=[],pending=new Map();let fields=[],collection;
  for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
    let item;try{item=JSON.parse(line);}catch{continue;}
    if(item.type==='start')fields=item.fields;
    if(item.type==='preview'){
      if(collection!==item.collection){pending.clear();collection=item.collection;}
      for(const row of item.rows)pending.set(row.id,row.values);
    }
    if(item.type==='commit'){pending.clear();for(const row of item.rows)rows.push(row);}
    if(item.type==='clear')pending.clear();
  }
  for(const row of pending.values())rows.push(row);return {fields,rows};
}
module.exports={readJournal};
