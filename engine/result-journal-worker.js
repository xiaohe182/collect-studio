'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
fs.mkdirSync(path.dirname(workerData.file), { recursive: true });
const fd = fs.openSync(workerData.file, 'a');
let dirty = false, snapshot = null;
function flush() { if (dirty) { fs.fsyncSync(fd);dirty = false; } }
function abortSnapshot() {
  if (!snapshot) return;
  try { fs.closeSync(snapshot.fd); } catch {}
  for (const file of [snapshot.file + '.tmp', snapshot.file + '.summary.tmp']) {
    try { fs.unlinkSync(file); } catch {}
  }
  snapshot = null;
}
parentPort.on('message', message => {
  try {
    if (message.record) {
      const data = Buffer.from(JSON.stringify(message.record) + '\n', 'utf8');
      let offset = 0;
      while (offset < data.length) offset += fs.writeSync(fd, data, offset, data.length - offset);
      dirty = true;
    }
    if (message.flush) flush();
    if (message.snapshotStart) {
      abortSnapshot();
      const { file, metadata } = message.snapshotStart;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      snapshot = { file, fd: fs.openSync(file + '.tmp', 'w'), summary: metadata.summary, count: 0 };
      fs.writeFileSync(snapshot.fd, JSON.stringify(metadata).slice(0, -1) + ',"rows":[');
    }
    if (message.snapshotRows) {
      if (message.snapshotRows.length) {
        fs.writeFileSync(snapshot.fd, (snapshot.count ? ',' : '') + message.snapshotRows.map(row => JSON.stringify(row)).join(','));
        snapshot.count += message.snapshotRows.length;
      }
    }
    if (message.snapshotFinish) {
      fs.writeFileSync(snapshot.fd, ']}');fs.fsyncSync(snapshot.fd);fs.closeSync(snapshot.fd);
      fs.writeFileSync(snapshot.file + '.summary.tmp', JSON.stringify(snapshot.summary));
      fs.renameSync(snapshot.file + '.tmp', snapshot.file);
      fs.renameSync(snapshot.file + '.summary.tmp', snapshot.file + '.summary');
      snapshot = null;flush();
    }
    if (message.snapshotAbort) abortSnapshot();
    if (message.id) parentPort.postMessage({ id: message.id });
  } catch (error) {
    const fatal = Boolean(message.record || message.flush);
    if (!fatal) abortSnapshot();
    parentPort.postMessage({ error: error.message, id: message.id, fatal });
  }
});
setInterval(() => {
  try { flush(); }
  catch (error) { parentPort.postMessage({ error: error.message, fatal: true }); }
}, 500).unref();
