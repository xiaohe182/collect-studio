'use strict';
const { Worker } = require('node:worker_threads');
const { setImmediate: yieldToMain } = require('node:timers/promises');
const path = require('node:path');

class ResultJournal {
  constructor(file, onError = () => {}) {
    this.file = file;this.onError = onError;this.sequence = 0;this.pending = new Map();
    this.failure = null;this.closed = false;this.terminating = false;
    this.operationQueue = Promise.resolve();this.queuedOperations = 0;this.closePromise = null;
    this.worker = new Worker(path.join(__dirname, 'result-journal-worker.js'), { workerData: { file } });
    this.worker.on('message', message => {
      if (message.error && (!message.id || message.fatal)) { this.fail(new Error(message.error));return; }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) { this.onError(message.error);waiting.reject(new Error(message.error)); }
      else waiting.resolve();
      this.updateRef();
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => {
      if (!this.terminating) this.fail(new Error('采集备份线程已退出（' + code + '）'));
    });
    this.worker.unref();
  }
  updateRef() {
    if (this.pending.size || this.queuedOperations) this.worker.ref();
    else this.worker.unref();
  }
  fail(error) {
    if (this.failure || this.terminating) return;
    this.failure = error;this.onError(error.message);
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();this.updateRef();
    this.worker.terminate().catch(() => {});
  }
  request(message) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('采集备份已关闭'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });this.updateRef();
      try { this.worker.postMessage({ ...message, id }); }
      catch (error) { this.pending.delete(id);this.updateRef();reject(error); }
    });
  }
  enqueue(operation) {
    this.queuedOperations++;this.updateRef();
    const current = this.operationQueue.then(async () => {
      try { return await operation(); }
      finally { this.queuedOperations--;this.updateRef(); }
    });
    this.operationQueue = current.catch(() => {});
    return current;
  }
  write(record) {
    if (this.failure || this.closed || this.closePromise) return false;
    const { rows, ...metadata } = record, total = rows?.length || 0;
    this.enqueue(async () => {
      if (!total) { await this.request({ record });return; }
      for (let start = 0; start < total; start += 1000) {
        await this.request({ record: { ...metadata, rows: rows.slice(start, Math.min(total, start + 1000)) } });
        await yieldToMain();
      }
    }).catch(error => this.fail(error));
    return true;
  }
  flush() { return this.enqueue(() => this.request({ flush: true })); }
  snapshot(file, data) {
    if (this.closed || this.closePromise) return Promise.reject(new Error('采集备份已关闭'));
    const { rows, ...metadata } = data, total = rows.length;
    return this.enqueue(async () => {
      try {
        await this.request({ snapshotStart: { file, metadata } });
        for (let start = 0; start < total; start += 1000) {
          await this.request({ snapshotRows: rows.slice(start, Math.min(total, start + 1000)) });
          await yieldToMain();
        }
        await this.request({ snapshotFinish: true });
      } catch (error) {
        await this.request({ snapshotAbort: true }).catch(() => {});throw error;
      }
    });
  }
  close() {
    if (!this.closePromise) this.closePromise = (async () => {
      try { await this.flush(); }
      finally { this.terminating = true;this.closed = true;await this.worker.terminate(); }
    })();
    return this.closePromise;
  }
}
module.exports = { ResultJournal };
