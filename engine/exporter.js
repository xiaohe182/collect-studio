'use strict';
const fs = require('fs');
const path = require('path');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sanitize(name) {
  return (name || '采集').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
}

// Called inside the I/O worker for large exports. Batches bound CSV/JSON memory,
// and exclusive creation keeps consecutive exports from replacing earlier files.
function createExportWriter(fields, format, outDir, prefix, firstRow = []) {
  const headers = fields?.length ? fields.map(f => f.name) : firstRow.map((_, i) => '字段' + (i + 1));
  const ext = format === 'json' || format === 'xlsx' ? format : 'csv';
  const base = sanitize(prefix) + '_' + stamp();
  let file, fd, count = 0, closed = false, sheet, XLSX;
  for (let suffix = 0; ; suffix++) {
    file = path.join(outDir, base + (suffix ? '-' + suffix : '') + '.' + ext);
    try { fd = fs.openSync(file, 'wx'); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const esc = value => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  function abort() {
    if (closed) return;
    closed = true;
    try { fs.closeSync(fd); } finally { fs.unlinkSync(file); }
  }
  try {
    if (ext === 'json') fs.writeFileSync(fd, '[\n');
    else if (ext === 'csv') fs.writeFileSync(fd, '\ufeff' + headers.map(esc).join(','));
    else {
      XLSX = require('xlsx');
      sheet = XLSX.utils.aoa_to_sheet([headers]);
      sheet['!cols'] = headers.map(name => ({ wch: Math.min(60, Math.max(8, String(name).length + 2)) }));
    }
  } catch (error) { abort(); throw error; }
  return {
    append(rows) {
      if (ext === 'json') {
        const lines = rows.map(row => {
          const item = Object.create(null);
          headers.forEach((name, i) => { item[name] = row[i] != null ? row[i] : ''; });
          return JSON.stringify(item);
        });
        if (lines.length) fs.writeFileSync(fd, (count ? ',\n' : '') + lines.join(',\n'));
      } else if (ext === 'csv') {
        if (rows.length) fs.writeFileSync(fd, '\r\n' + rows.map(row => row.map(esc).join(',')).join('\r\n'));
      } else {
        XLSX.utils.sheet_add_aoa(sheet, rows, { origin: { r: count + 1, c: 0 } });
        for (const row of rows.slice(0, Math.max(0, 200 - count))) {
          headers.forEach((_, i) => { sheet['!cols'][i].wch = Math.min(60, Math.max(sheet['!cols'][i].wch, String(row[i] ?? '').length + 2)); });
        }
      }
      count += rows.length;
    },
    finish() {
      if (ext === 'json') fs.writeFileSync(fd, '\n]\n');
      if (ext === 'xlsx') {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, '数据');
        fs.writeFileSync(fd, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
      }
      fs.closeSync(fd);closed = true;
      return { ok: true, path: file, count };
    },
    abort,
  };
}

/** Synchronous compatibility entry for CLI callers; UI uses exportRowsAsync. */
function exportRows(rows, fields, format, outDir, prefix) {
  let writer;
  try {
    writer = createExportWriter(fields, format, outDir, prefix, rows[0]);
    for (let i = 0; i < rows.length; i += 1000) writer.append(rows.slice(i, i + 1000));
    return writer.finish();
  } catch (error) {
    try { writer?.abort(); } catch {}
    return { ok: false, error: error.message };
  }
}
function exportRowsAsync(rows, fields, format, outDir, prefix) {
  return require('./result-io').exportRowsAsync(rows, fields, format, outDir, prefix);
}
module.exports = { exportRows, exportRowsAsync, createExportWriter };
