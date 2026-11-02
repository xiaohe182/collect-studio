'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { setImmediate: yieldToMain } = require('node:timers/promises');
const BATCH_ROWS = 1000;
let worker = null, sequence = 0, queue = Promise.resolve();
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  const active = new Worker(path.join(__dirname, 'result-io-worker.js'));
  worker = active;
  active.on('message', message => {
    const request = pending.get(message.id);
    if (!request || request.worker !== active) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  const fail = error => {
    if (worker === active) worker = null;
    for (const [id, request] of pending) if (request.worker === active) { pending.delete(id);request.reject(error); }
  };
  active.on('error', fail);
  active.on('exit', code => fail(new Error('数据处理线程已退出（' + code + '）')));
  active.unref();
  return active;
}
function request(active, operation, data = {}) {
  if (worker !== active) return Promise.reject(new Error('数据处理线程已退出'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: active });
    try { active.postMessage({ id, operation, ...data }); }
    catch (error) { pending.delete(id);reject(error); }
  });
}
// Keep one operation active: exports cannot interleave chunks or grow a queue of
// copied datasets. Ref only for the operation so the idle worker never holds quit.
function runJob(job) {
  const current = queue.then(async () => {
    const active = getWorker();active.ref();
    try { return await job((operation, data) => request(active, operation, data)); }
    finally { active.unref(); }
  });
  queue = current.catch(() => {});
  return current;
}
function exportRowsAsync(rows, fields, format, outDir, prefix) {
  const total = rows.length;
  const savedFields = fields?.map(field => ({ name: field.name }));
  return runJob(async send => {
    try {
      await send('export-start', { fields: savedFields, format, outDir, prefix, firstRow: rows[0] });
      for (let start = 0; start < total; start += BATCH_ROWS) {
        await send('export-chunk', { rows: rows.slice(start, Math.min(total, start + BATCH_ROWS)) });
        await yieldToMain();
      }
      return await send('export-finish');
    } catch (error) {
      await send('export-abort').catch(() => {});
      return { ok: false, error: error.message };
    }
  }).catch(error => ({ ok: false, error: error.message }));
}
function readRunPage(file, page = 0, pageSize = 100) {
  return runJob(send => send('read-run-page', { file, page, pageSize }));
}
function listRunHistory(folder, limit = 50) {
  return runJob(send => send('list-history', { folder, limit }));
}
function readTaskCatalog(folder) {
  return runJob(send => send('read-task-catalog', { folder }));
}
function exportRunAsync(file, format, outDir, prefix) {
  return runJob(send => send('export-run', { file, format, outDir, prefix }))
    .catch(error => ({ ok: false, error: error.message }));
}
function exportRunLogsAsync(file, outFile) {
  return runJob(send => send('export-run-logs', { file, outFile }));
}
function readJournalAsync(file) {
  return runJob(async send => {
    const { fields, total } = await send('journal-open', { file });
    const rows = [];
    try {
      for (let start = 0; start < total; start += BATCH_ROWS) {
        const batch = await send('journal-page', { start, count: BATCH_ROWS });
        for (const row of batch) rows.push(row);
        await yieldToMain();
      }
      return { fields, rows };
    } finally { await send('journal-close').catch(() => {}); }
  });
}
module.exports = { exportRowsAsync, readRunPage, listRunHistory, readTaskCatalog, exportRunAsync, exportRunLogsAsync, readJournalAsync };
