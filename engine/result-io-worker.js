'use strict';
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
const { createExportWriter, exportRows } = require('./exporter');
let cachedRun = null, exportWriter = null, recoveredJournal = null;
let catalogFolder = null;
const catalogFiles = new Map();

function readRun(file) {
  const stat = fs.statSync(file);
  const version = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
  if (cachedRun?.file !== file || cachedRun.version !== version) {
    cachedRun = null;
    cachedRun = { file, version, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  return cachedRun.data;
}
function listHistory(folder, limit) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(name => /^\d+\.json$/.test(name)).sort().reverse().slice(0, limit).flatMap(name => {
    try {
      const file = path.join(folder, name), summaryFile = file + '.summary';
      const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : JSON.parse(fs.readFileSync(file, 'utf8')).summary;
      return [{ ...summary, id: name.slice(0, -5) }];
    } catch { return []; }
  });
}
function readTaskCatalog(folder) {
  if (catalogFolder !== folder) { catalogFolder = folder;catalogFiles.clear(); }
  const seen = new Set();let declaredGroups = [];
  function scan(archived) {
    const dir = archived ? path.join(folder, 'archive') : folder;
    if (!fs.existsSync(dir)) return [];
    const tasks = [];
    for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
      const file = path.join(dir, name), groupFile = !archived && name === 'groups.json';
      seen.add(file);
      try {
        const stat = fs.statSync(file), version = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
        let entry = catalogFiles.get(file);
        if (entry?.version !== version) {
          let metadata = null, groups;
          try {
            const config = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (groupFile) groups = [...config];
            else if (config.url) {
              let host;
              try { host = new URL(config.url).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '_'); }
              catch { host = 'unknown'; }
              metadata = { id: name.slice(0, -5), name: config.name || host, group: config.group || '', url: config.url, updatedAt: config.updatedAt || '' };
            }
          } catch (error) { if (groupFile) throw error; }
          entry = { version, metadata, groups };catalogFiles.set(file, entry);
        }
        if (groupFile) declaredGroups = entry.groups;
        else if (entry.metadata) tasks.push(entry.metadata);
      } catch (error) { if (groupFile) throw error; }
    }
    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const tasks = scan(false), archivedTasks = scan(true);
  for (const file of catalogFiles.keys()) if (!seen.has(file)) catalogFiles.delete(file);
  const groups = [...new Set([...declaredGroups, ...tasks.map(task => task.group), ...archivedTasks.map(task => task.group)].filter(Boolean))];
  return { tasks, archivedTasks, groups };
}
async function execute(message) {
  switch (message.operation) {
    case 'export-start':
      cachedRun = null;
      exportWriter?.abort();
      exportWriter = createExportWriter(message.fields, message.format, message.outDir, message.prefix, message.firstRow);
      return true;
    case 'export-chunk': exportWriter.append(message.rows);return true;
    case 'export-finish': {
      const result = exportWriter.finish();exportWriter = null;return result;
    }
    case 'export-abort': exportWriter?.abort();exportWriter = null;return true;
    case 'read-run-page': {
      const run = readRun(message.file), total = run.rows.length;
      const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(message.pageSize)) || 100));
      const requested = Number(message.page), page = Math.min(Math.max(0, Math.ceil(total / pageSize) - 1), Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0));
      return { summary: run.summary, fields: run.fields, rows: run.rows.slice(page * pageSize, (page + 1) * pageSize), total, logs: (run.logs || []).slice(-500), page, pageSize };
    }
    case 'list-history': return listHistory(message.folder, message.limit);
    case 'read-task-catalog': return readTaskCatalog(message.folder);
    case 'export-run': {
      const run = readRun(message.file);
      return exportRows(run.rows, run.fields, message.format, message.outDir, message.prefix);
    }
    case 'export-run-logs': {
      const run = readRun(message.file);
      fs.writeFileSync(message.outFile, (run.logs || []).map(item => `[${item.time}] ${item.message}`).join('\n'));
      return { ok: true, path: message.outFile };
    }
    case 'journal-open':
      cachedRun = null;
      recoveredJournal = null;
      recoveredJournal = await require('./journal-reader').readJournal(message.file);
      return { fields: recoveredJournal.fields, total: recoveredJournal.rows.length };
    case 'journal-page': return recoveredJournal.rows.slice(message.start, message.start + message.count);
    case 'journal-close': recoveredJournal = null;return true;
    default: throw new Error('未知数据处理操作');
  }
}
parentPort.on('message', async message => {
  try { parentPort.postMessage({ id: message.id, result: await execute(message) }); }
  catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
});
