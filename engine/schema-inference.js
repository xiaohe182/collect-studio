'use strict';

// Browser DOM adaptation of html-to-schema's relative-selector / record-field
// inference. See third-party/html-to-schema.LICENSE and schema-inference.md.
// Self-contained so pagecode can serialize it into the embedded browser.
function v6SchemaInference(items, helpers) {
  const sample = items.length <= 12 ? items : Array.from({length:12}, (_, i) => items[Math.floor(i * (items.length - 1) / 11)]);
  const fields = [], signatures = [], names = new Set();
  const escape = value => CSS.escape(value);
  const query = (root, sel) => sel === ':scope' ? [root] : Array.from(root.querySelectorAll(sel));
  const unique = (root, sel, node) => { const found = query(root, sel); return found.length === 1 && found[0] === node; };

  function selector(root, node) {
    if (node === root) return ':scope';
    const tag = node.tagName.toLowerCase();
    // Attribute values that express field roles, never per-record IDs/prices.
    for (const attr of ['itemprop', 'data-field', 'data-testid', 'data-role']) {
      const value = node.getAttribute(attr);
      if (value) {
        const sel = tag + '[' + attr + '=' + escape(value) + ']';
        if (unique(root, sel, node)) return sel;
      }
    }
    const classes = Array.from(node.classList).filter(c => helpers.stableClass({classList:[c]}));
    for (const cls of classes) {
      const sel = tag + '.' + escape(cls);
      if (unique(root, sel, node)) return sel;
    }
    if (classes.length) {
      const sel = tag + classes.map(c => '.' + escape(c)).join('');
      if (unique(root, sel, node)) return sel;
    }
    // An unclassed fallback must not swallow a different semantic field in a
    // record where this optional field is absent.
    if (unique(root, tag, node) && sample.every(r => query(r, tag).length <= 1)) return tag;
    const parts = [];
    for (let cur = node; cur && cur !== root; cur = cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(e => e.tagName === cur.tagName);
      parts.unshift(cur.tagName.toLowerCase() + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')' : ''));
    }
    return ':scope > ' + parts.join(' > ');
  }

  function emit(root, node, type) {
    const rel = selector(root, node);
    const matches = sample.map(r => query(r, rel));
    if (matches.some(nodes => nodes.length > 1)) return;
    const support = matches.filter(nodes => nodes.length === 1).length;
    const semantic = /\[|\./.test(rel);
    if (support < (semantic ? 1 : Math.min(2, sample.length))) return;
    const nodes = matches.map(m => m[0] || null);
    if (signatures.some(s => s.type === type && s.nodes.every((n, i) => n === nodes[i]))) return;
    // Avoid accidental positional substitutions between named fields.
    const role = node.getAttribute('itemprop');
    if (role && nodes.some(n => n && n.getAttribute('itemprop') !== role)) return;
    let name = type === 'href' ? '链接' : /^H[1-6]$/.test(node.tagName) ? '标题' :
      role === 'price' || /price/i.test(node.className || '') ? '价格' : helpers.name(node, fields.length, fields);
    const base = name; let suffix = 2;
    while (names.has(name)) name = base + suffix++;
    names.add(name);
    const field = {name, type, rel};
    if (node.hasAttribute('content') && type === 'text') field.attr = 'content';
    field.sample = type === 'img' ? (node.getAttribute('data-src') || node.getAttribute('data-original') || node.getAttribute('src') || '') :
      type === 'href' ? node.href : node.getAttribute('content') || (node.innerText || node.textContent || '').trim().slice(0, 50);
    fields.push(field); signatures.push({type, nodes});
  }

  // Union of representative records: fields missing in the first record are
  // still discoverable. No __idx fallback: missing data must remain empty.
  for (const root of sample) {
    const nodes = new Set(helpers.fieldNodes(root));
    root.querySelectorAll('img[data-src],img[data-original],[itemprop][content]').forEach(n => nodes.add(n));
    if (!nodes.size && (root.innerText || '').trim()) nodes.add(root);
    for (const node of nodes) emit(root, node, node.tagName === 'IMG' ? 'img' : 'text');
    const links = Array.from(root.querySelectorAll('a[href]'));
    if (root.matches('a[href]')) links.unshift(root);
    links.forEach(node => emit(root, node, 'href'));
  }
  return fields;
}

module.exports = v6SchemaInference;
