'use strict';
const v6SchemaInference = require('./schema-inference');
const {collectVirtualTable}=require('./virtual-table');
const {readTableCell}=require('./table-cell');
const {genericTable}=require('./generic-table');
const controlCss = require('node:fs').readFileSync(require('node:path').join(__dirname,'../renderer/control-theme.css'),'utf8');
/**
 * 页面内执行的代码集合。
 * 所有函数都会以 fn.toString() 的形式注入目标页面执行，
 * 因此只能依赖浏览器环境，互相调用时必须保证依赖函数也被一起注入。
 */

// ============ 基础工具（注入依赖） ============

// 找一个"稳定"的 class（过滤 css-in-js / 构建工具生成的哈希类名）
function v6StableClass(el) {
  const cls = Array.from(el.classList || []);
  const bad = c => !c || c.length > 40 || /[0-9a-f]{5,}/i.test(c) || /^css-/i.test(c) || /^sc-/i.test(c) || /^[_\w]*\d[_\d]*$/.test(c) && /\d/.test(c) && c.replace(/\D/g, '').length > 2;
  return cls.find(c => !bad(c)) || null;
}

// 从 el 向上构建 CSS 路径，到 root 为止（不含 root）；root 传 document.body 表示绝对路径
// 绝对路径优先用稳定 class，若存在歧义（多个匹配）则逐级补 nth-child 保证唯一定位
function v6CssPath(el, root) {
  function idx(cur) {
    let i = 1, s = cur;
    while ((s = s.previousElementSibling)) i++;
    return i;
  }
  function esc(c) { return window.CSS && CSS.escape ? CSS.escape(c) : c; }
  const abs = root === document.body;
  function stableId(id) {
    return /^[A-Za-z][\w-]{1,60}$/.test(id) && !/^(?:el-id-|el-\w+-\d|rc[_-]|radix-|headlessui-|react-|mui-)|\d{4,}|[a-f0-9]{8}-/i.test(id);
  }
  if(abs){
    const tag=el.tagName.toLowerCase();
    const unique=selector=>{const nodes=document.querySelectorAll(selector);return nodes.length===1&&nodes[0]===el;};
    if(stableId(el.id)){
      const selector=tag+'#'+esc(el.id);if(unique(selector))return selector;
    }
    // 表单组件的自动 ID 每次挂载会变；优先使用语义属性并校验唯一性。
    for(const key of ['data-testid','name','autocomplete','aria-label','placeholder','type']){
      const value=el.getAttribute(key);if(!value||value==='off'||value==='on')continue;
      const selector=tag+'['+key+'='+JSON.stringify(value)+']';
      if(unique(selector))return selector;
      for(let parent=el.parentElement,depth=0;parent&&parent!==root&&depth<5;parent=parent.parentElement,depth++){
        const cls=v6StableClass(parent);
        const scope=stableId(parent.id)?'#'+esc(parent.id):cls?parent.tagName.toLowerCase()+'.'+esc(cls):null;
        if(scope&&unique(scope+' '+selector))return scope+' '+selector;
      }
    }
  }
  if(!abs && root && el!==root){
    // 字段优先使用在当前卡片内唯一的语义类，避免广告徽标改变子节点序号。
    for(const cls of Array.from(el.classList||[])){
      if(v6StableClass({classList:[cls]})!==cls)continue;
      const selector='.'+esc(cls);
      if(root.querySelectorAll(selector).length===1)return selector;
    }
  }
  const simple = [];
  const strict = [];
  let cur = el;
  let depth = 0;
  let idHit = null;
  while (cur && cur.nodeType === 1 && cur !== root && depth < 10) {
    const cls = v6StableClass(cur);
    let sp = cur.tagName.toLowerCase();
    let tp = sp;
    if (stableId(cur.id)) { idHit = sp + '#' + esc(cur.id); break; }
    if (cls) sp += '.' + esc(cls);
    tp += ':nth-child(' + idx(cur) + ')';
    if (cls) tp += '.' + esc(cls);
    simple.unshift(sp);
    strict.unshift(tp);
    cur = cur.parentElement;
    depth++;
  }
  if (!abs) {
    // 相对路径：始终带 nth-child，唯一定位
    if (idHit) strict.unshift(idHit);
    return strict.join(' > ');
  }
  if (idHit) { simple.unshift(idHit); strict.unshift(idHit); }
  const selS = simple.join(' > ');
  try {
    if (selS && document.querySelectorAll(selS).length === 1) return selS;
  } catch (e) {}
  return strict.join(' > ');
}

// 收集条目内的"字段节点"：有直接文本的元素 或 图片
// 若外层节点的直接文本只是胶水文字（如 "by "），则丢弃外层、保留内层字段
function v6FieldNodes(item) {
  const out = [];
  const glue = el => {
    let n = 0;
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) n += ch.textContent.trim().length;
    }
    return n;
  };
  const all = item.querySelectorAll('*');
  for (const node of all) {
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;
    const hasText = Array.from(node.childNodes).some(ch => ch.nodeType === 3 && ch.textContent.trim().length > 0);
    const isImg = node.tagName === 'IMG' && (node.getAttribute('src') || node.src);
    if (!hasText && !isImg) continue;
    out.push(node);
  }
  // 后处理：外层包含已收字段且自身文本是胶水 → 丢弃外层
  const containingFields = new Set();
  for(const node of out){
    for(let parent=node.parentElement;parent&&parent!==item;parent=parent.parentElement){
      if(containingFields.has(parent))break;
      containingFields.add(parent);
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const node = out[i];
    const hasInner = containingFields.has(node);
    if (hasInner && !node.tagName.match(/^IMG|INPUT|SELECT|TEXTAREA$/) && glue(node) < 12) {
      out.splice(i, 1);
    }
  }
  return out;
}

// 给字段起个聪明的名字
function v6SmartName(node, idx, existing) {
  let name;
  if (node.tagName === 'IMG') name = '图片';
  else {
    const t = (node.innerText || '').trim();
    if (/^[¥￥$€£]/.test(t) || /\d[\d,.]*\s*(元|USD|CNY|块)/.test(t)) name = '价格';
    else if (/^(19|20)\d{2}[-/.年]/.test(t) || /^\d{1,2}:\d{2}/.test(t) || /(分钟前|小时前|天前|刚刚)/.test(t)) name = '时间';
    else if (t.length > 100) name = '内容';
    else if (node.closest('a[href]') && t.length <= 80) name = '标题';
    else if (t.length >= 15) name = '描述';
    else name = '字段' + (idx + 1);
  }
  let base = name, k = 2;
  while (existing.some(f => f.name === name)) { name = base + k; k++; }
  return name;
}

// 解析列表配置 → 条目元素数组
function v6ResolveItems(list) {
  if (!list) return [];
  try {
    if(list.type==='fieldSelection')return v6ResolveItems(list.list).flatMap(item=>list.fields.map(field=>field.rel===':scope'?item:item.querySelector(field.rel)).filter(Boolean));
    if (list.type === 'css') return Array.from(document.querySelectorAll(list.selector));
    if (list.type === 'xpath') {
      const result = document.evaluate(list.selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i)).filter(el => el.nodeType === 1);
    }
    if (list.type === 'table') {
      const t = document.querySelector(list.tablePath);
      if (!t) return [];
      return Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td') && r.parentElement.tagName !== 'THEAD');
    }
    if (list.type === 'sig') {
      let sel = list.tag + (list.cls ? '.' + list.cls.split(/\s+/).map(c => window.CSS && CSS.escape ? CSS.escape(c) : c).join('.') : '');
      return Array.from(document.querySelectorAll(sel)).filter(e => (e.innerText || '').trim().length > 0);
    }
    // siblings
    const parent = document.querySelector(list.parentPath);
    if (!parent) return [];
    return Array.from(parent.children).filter(c => c.tagName === list.tag && (!list.cls || c.classList.contains(list.cls)));
  } catch (e) { return []; }
}

// 按字段配置从条目提取一行值
function v6ExtractRow(item, fields) {
  const vals = [];
  for (const f of fields) {
    let v = '';
    try {
      if(f.tableColumn){
        const split=f.tableColumn.indexOf(':'),attr=f.tableColumn.slice(0,split),value=f.tableColumn.slice(split+1);
        let cell;
        const table=item.closest('.vxe-table,[role="grid"],[role="table"]')||item.closest('table');
        const usable=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!el.matches('.fixed--hidden,.is--progress');
        const peers=table?.matches('.vxe-table')&&item.hasAttribute('rowid')?Array.from(table.querySelectorAll('tr[rowid]')).filter(row=>row.getAttribute('rowid')===item.getAttribute('rowid')&&row.closest('.vxe-table')===table):[item];
        const rowCells=peers.flatMap(row=>Array.from(row.children)).filter(usable);
        const allHeaders=Array.from(table?.querySelectorAll('th,[role="columnheader"]')||[]);
        const headers=allHeaders.filter(h=>(h.textContent||'').replace(/\s+/g,' ').trim()===(f.tableHeader||f.name));
        const recordedHeader=allHeaders.find(h=>h.getAttribute(attr)===value);
        const useRecorded=!recordedHeader||(recordedHeader.textContent||'').replace(/\s+/g,' ').trim()===(f.tableHeader||f.name);
        const keys=new Map(headers.map(h=>{const key=['aria-colindex','data-col-key','data-column-key','col-id','colid'].find(a=>h.hasAttribute(a));return [key?key+':'+h.getAttribute(key):'',h];}));
        if(keys.size===1&&keys.keys().next().value){
          const key=keys.keys().next().value,separator=key.indexOf(':');
          cell=rowCells.find(c=>c.getAttribute(key.slice(0,separator))===key.slice(separator+1));
        }
        if(!cell&&useRecorded&&attr==='x'){
          let sc=item.parentElement;while(sc&&!(/auto|scroll/.test(getComputedStyle(sc).overflowX)&&sc.scrollWidth>sc.clientWidth+1))sc=sc.parentElement;
          cell=rowCells.find(c=>Math.abs(Math.round((c.getBoundingClientRect().left-(sc?.getBoundingClientRect().left||0)+(sc?.scrollLeft||0))*10)/10-Number(value))<1);
        }else if(!cell&&useRecorded)cell=rowCells.find(c=>c.getAttribute(attr)===value);
        v=readTableCell(cell,f);
      } else if(f.virtualColumn){
        const table=item.closest('.vxe-table');
        const th=Array.from(table?.querySelectorAll('th[colid]')||[]).find(th=>(th.querySelector('.vxe-cell--title')?.textContent||'').trim()===f.virtualColumn);
        const id=th?.getAttribute('colid');
        const cell=Array.from(item.querySelectorAll('td[colid]')).find(td=>td.getAttribute('colid')===id);
        v=readTableCell(cell,f);
      } else if (f.index != null) { // 表格列
        const td = item.children[f.index];
        v = readTableCell(td,f);
      } else {
        let node = null;
        if (f.xpath) node = document.evaluate(f.xpath, item, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        else if (f.rel === ':scope') node = item;
        else if (f.rel) { try { node = item.querySelector(f.rel); } catch (e) { node = null; } }
        if (!node && f.__idx != null) node = v6FieldNodes(item)[f.__idx] || null;
        if (node) {
          if (f.attr && f.type === 'text') v = node.getAttribute(f.attr) || '';
          else if (f.type === 'html') v = node.outerHTML || '';
          else if (f.type === 'innerHtml') v = node.innerHTML || '';
          else if (f.type === 'value') v = node.value || '';
          else if (f.type === 'img') v = node.getAttribute('data-src') || node.getAttribute('data-original') || node.getAttribute('src') || node.src || '';
          else if (f.type === 'href') {
            const a = node.closest ? node.closest('a[href]') : null;
            v = a ? a.href : '';
          } else v = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        }
      }
    } catch (e) { v = ''; }
    vals.push(v);
  }
  return vals;
}

// 按稳定语义选择器对齐字段，缺失字段留空。
function v6AlignFields(items) {
  return v6SchemaInference(items, {fieldNodes:v6FieldNodes, name:v6SmartName, stableClass:v6StableClass});
}

// 给一组条目打分（越像"数据列表"分越高）
function v6ScoreGroup(els) {
  const n = els.length;
  let textSum = 0, linkCount = 0, imgCount = 0, smallCount = 0;
  const htmlSigs = new Set();
  let inNav = false;
  for (let i = 0; i < n; i++) {
    const el = els[i];
    textSum += (el.innerText || '').trim().length;
    if (el.querySelector('a[href]')) linkCount++;
    if (el.querySelector('img')) imgCount++;
    const html = el.innerHTML;
    if (html.length < 6000) htmlSigs.add(html.replace(/\s+/g, ' ').slice(0, 400));
    const r = el.getBoundingClientRect();
    if (r.height < 18 || r.width < 60) smallCount++;
    if (i === 0) {
      let p = el;
      while (p && p !== document.body) {
        const tn = p.tagName;
        if (tn === 'NAV' || tn === 'HEADER' || tn === 'FOOTER') inNav = true;
        if (p.getAttribute && p.getAttribute('role') === 'navigation') inNav = true;
        p = p.parentElement;
      }
    }
  }
  const avgText = textSum / n;
  let score = Math.min(n, 60);
  if (avgText >= 12 && avgText <= 1200) score += 30;
  else if (avgText < 4) score -= 30;
  if (linkCount / n > 0.25) score += 8;
  if (imgCount / n > 0.25) score += 8;
  if (n >= 4 && htmlSigs.size === 1) score -= 25;           // 完全相同的标签 → 多半是菜单
  if (smallCount > n * 0.4) score -= 30;                     // 太小的条目
  if (inNav) score -= 45;                                    // 在导航/页头页脚里
  // 可视区域覆盖：整组高度超过一屏 → 无限列表加分
  const firstR = els[0].getBoundingClientRect();
  const lastR = els[els.length - 1].getBoundingClientRect();
  if (lastR.bottom - firstR.top > window.innerHeight * 1.2) score += 10;
  return { score, avgText };
}

// ============ 注入入口 ============

// --- 自动识别 ---
function v6Detect() {
  const body = document.body;
  if (!body) return { ok: false, error: '页面无 body' };
  const groups = [];

  // 1) 兄弟同构组：同一父节点下 tag+class 相同的子元素 ≥3 个
  const parents = new Set();
  body.querySelectorAll('*').forEach(el => { if (el.parentElement) parents.add(el.parentElement); });
  const sibSets = [];
  parents.forEach(p => {
    const sigMap = new Map();
    Array.from(p.children).forEach(ch => {
      const tn = ch.tagName;
      if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'LINK' || tn === 'BR' || tn === 'TEMPLATE') return;
      const cls = v6StableClass(ch);
      const sig = tn + '|' + (cls || '');
      if (!sigMap.has(sig)) sigMap.set(sig, []);
      sigMap.get(sig).push(ch);
    });
    sigMap.forEach((els, sig) => {
      if (els.length >= 3) {
        const cls = v6StableClass(els[0]) || '';
        sibSets.push(new Set(els));
        groups.push({ type: 'siblings', parent: p, tag: els[0].tagName, cls, els });
      }
    });
  });

  // 2) 全局同类组：整页共享相同 tag+class 的元素 ≥5 个（React/Vue 列表常见）
  const gMap = new Map();
  body.querySelectorAll('*').forEach(el => {
    const cls = v6StableClass(el);
    if (!cls) return;
    const sig = el.tagName + '|' + cls;
    if (!gMap.has(sig)) gMap.set(sig, []);
    gMap.get(sig).push(el);
  });
  gMap.forEach((els, sig) => {
    if (els.length < 5) return;
    const covered = sibSets.some(set => set.size === els.length && els.every(e => set.has(e)));
    if (covered) return;
    groups.push({ type: 'sig', tag: els[0].tagName, cls: sig.slice(sig.indexOf('|') + 1), els });
  });

  // 3) 表格
  body.querySelectorAll('table').forEach(t => {
    const rows = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td') && r.parentElement.tagName !== 'THEAD');
    if (rows.length >= 3) groups.push({ type: 'table', tableEl: t, els: rows });
  });

  // 4) 打分
  const candidates = [];
  for (const g of groups) {
    const els = g.els.filter(e => !e.closest('[id^="__v6"]') && (e.offsetParent !== null || getComputedStyle(e).position === 'fixed'));
    if (els.length < 3) continue;
    if (g.type !== 'table') {
      // 字段预对齐失败（比如全是空壳节点）的直接丢弃
      if (!v6FieldNodes(els[0]).length && !(els[0].innerText||'').trim()) continue;
    }
    const sc = v6ScoreGroup(els);
    const shortText=els.every(el=>(el.innerText||'').trim().length>0&&(el.innerText||'').trim().length<100);
    if (sc.score <= 15 && !shortText) continue;

    let list, fields;
    if (g.type === 'table') {
      list = { type: 'table', tablePath: v6CssPath(g.tableEl, document.body) };
      const headers = Array.from(g.tableEl.querySelectorAll('thead th, thead td')).map(th => (th.innerText || '').trim());
      const ncols = els[0].children.length;
      if (ncols < 2) continue;
      fields = [];
      for (let i = 0; i < ncols; i++) {
        fields.push({
          name: headers[i] || ('列' + (i + 1)),
          type: 'text', index: i,
          sample: ((els[0].children[i] || {}).innerText || '').trim().slice(0, 50),
        });
      }
    } else {
      fields = v6AlignFields(els);
      if (!fields.length) fields=[{name:'文本',type:'text',rel:':scope',sample:(els[0].innerText||'').trim()}];
      if (g.type === 'siblings') {
        list = { type: 'siblings', parentPath: v6CssPath(g.parent, document.body), tag: g.tag, cls: g.cls };
      } else {
        list = { type: 'sig', tag: g.tag, cls: g.cls };
      }
    }
    candidates.push({
      type: g.type,
      score: sc.score,
      count: els.length,
      avgText: Math.round(sc.avgText),
      fields,
      list,
      samples: els.slice(0, 3).map(it => v6ExtractRow(it, fields)),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const distinct=[];
  for(const candidate of candidates){const elements=v6ResolveItems(candidate.list);if(distinct.some(c=>{const other=v6ResolveItems(c.list);return other.length===elements.length&&other.every((el,i)=>el===elements[i]);}))continue;distinct.push(candidate);}
  const top = distinct.slice(0, 20).map((c, i) => ({
    id: i,
    label: (c.type === 'table' ? '表格' : c.type === 'sig' ? '块列表' : '列表') + ' · ' + c.count + '项 · ' + c.fields.length + '字段 · 得分' + c.score,
    type: c.type, score: c.score, count: c.count, fields: c.fields, list: c.list, samples: c.samples,
  }));
  const moreButtons=Array.from(body.querySelectorAll('button,a,[role="button"],span')).filter(el=>{
    if(el.closest('[id^="__v6"]')||el.disabled||el.getAttribute('aria-disabled')==='true'||!el.getClientRects().length)return false;
    const text=(el.innerText||'').trim().replace(/\s+/g,' ');
    return /^(加载更多|点击加载更多|点击查看更多|显示更多|load more|show more)$/i.test(text);
  });
  const more=moreButtons.find(el=>!moreButtons.some(child=>child!==el&&el.contains(child)))||moreButtons[0];
  return { ok: true, url: location.href, title: document.title, candidates: top,loadMore:more?{type:'css',selector:v6CssPath(more,document.body),text:more.innerText.trim()}:null };
}

// --- 高亮预览：列表项橙色框 + 序号标牌（CSS 计数器，不改动 DOM 结构）+ 字段蓝色框 ---
function v6Highlight(cfg, on) {
  document.querySelectorAll('[data-v6hl],[data-v6fld]').forEach(e => { e.removeAttribute('data-v6hl'); e.removeAttribute('data-v6fld'); });
  const old = document.getElementById('__v6hl-style');
  if (old) old.remove();
  if (!on || !cfg || !cfg.list) return { on: false };
  const st = document.createElement('style');
  st.id = '__v6hl-style';
  st.textContent =
    'body{counter-reset:v6item}' +
    '[data-v6hl]{position:relative;outline:2px solid #1677ff !important;outline-offset:-2px;background:rgba(22,119,255,.05) !important;counter-increment:v6item}' +
    '[data-v6hl]::before{content:counter(v6item);position:absolute;top:0;left:0;z-index:2147483646;background:#1677ff;color:#fff;font:500 11px/1.8 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:0 7px;border-radius:0 0 4px 0;pointer-events:none}' +
    '[data-v6fld]{outline:1px solid #91caff !important;outline-offset:-1px;background:rgba(22,119,255,.08) !important}';
  document.head.appendChild(st);
  let n = 0;
  v6ResolveItems(cfg.list).forEach(it => {
    it.setAttribute('data-v6hl', '1');
    n++;
    cfg.fields.forEach(f => {
      if (f.index != null) {
        const td = it.children[f.index];
        if (td) td.setAttribute('data-v6fld', '1');
        return;
      }
      let node = null;
      try { node = f.rel ? it.querySelector(f.rel) : null; } catch (e) {}
      if (node) node.setAttribute('data-v6fld', '1');
    });
  });
  return { on: true, items: n };
}

// --- 手动点选模式 ---
function v6PickMode(on) {
  if (window.__v6pick) { window.__v6pick.off(); window.__v6pick = null; }
  if (!on) return { on: false };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff6a00;background:rgba(255,106,0,.12);display:none;box-sizing:border-box';
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#ff6a00;color:#fff;font:12px/1.7 sans-serif;padding:0 6px;border-radius:3px;display:none;white-space:nowrap';
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(tag);
  const menu = document.createElement('div');
  menu.id = '__v6-selection';
  menu.className='v6-controls';
  menu.style.cssText='position:fixed;top:12px;right:12px;width:260px;z-index:2147483647;background:white;color:#211c15;border:1px solid #dfe6ef;border-radius:4px;box-shadow:0 8px 28px #0002;padding:12px;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";display:none';
  const selectedStyle=document.createElement('style');
  selectedStyle.textContent=v6ControlCss+'\n[data-v6-selected]{outline:1px solid #00ac4f!important;outline-offset:-1px}';
  document.documentElement.append(menu,selectedStyle);
  let selected=null, selectionMode='single', selectionList=null;
  let inputDraft=null;
  const editable=el=>el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]');
  function inputEditor(el) {
    inputDraft ||= [];
    menu.querySelectorAll('[data-input-value]').forEach((input,i)=>inputDraft[i].value=input.value);
    const path=pickData(el).path;
    const xpath=pickData(el).xpath;
    if(!inputDraft.some(entry=>entry.selector===xpath))inputDraft.push({selector:xpath,value:'',mode:'xpath'});
    const enterWas=menu.querySelector('[data-input-enter]')?.checked || false;
    menu.replaceChildren();menu.style.display='block';
    const title=document.createElement('strong');title.textContent='输入文本';menu.append(title);
    const help=document.createElement('p');help.textContent='点击网页中的其他输入框可组合输入。确认后生成步骤并立即执行。';menu.append(help);
    inputDraft.forEach((entry,index)=>{
      const label=document.createElement('label');label.textContent='文本框 '+(index+1);label.style.display='block';
      const input=document.createElement('input');input.dataset.inputValue='';input.value=entry.value;input.style.cssText='box-sizing:border-box;width:100%;margin:4px 0 8px;padding:6px;border:1px solid #cbd5e1;border-radius:3px';input.oninput=()=>entry.value=input.value;
      label.append(input);menu.append(label);
    });
    const enterLabel=document.createElement('label'),enter=document.createElement('input');enter.type='checkbox';enter.dataset.inputEnter='';enter.checked=enterWas;enterLabel.append(enter,'输入后按回车 Enter');menu.append(enterLabel);
    const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>{inputDraft=null;choose(el);};
    const confirm=document.createElement('button');confirm.textContent='确定';confirm.dataset.inputConfirm='';confirm.onclick=()=>{
      menu.querySelectorAll('[data-input-value]').forEach((input,i)=>inputDraft[i].value=input.value);
      window.__v6?.send('record-input',{entries:inputDraft,enter:enter.checked});inputDraft=null;menu.style.display='none';
    };const actions=document.createElement('div');actions.className='prompt-actions';actions.append(cancel,confirm);menu.append(actions);
  }
  const history=[];
  const childrenOf=el=>Array.from(el.children).filter(child=>!['SCRIPT','STYLE','TEMPLATE','META','LINK'].includes(child.tagName));
  const fieldsOf=el=>v6FieldNodes(el).filter(node=>!node.closest('[id^="__v6"]')&&node.getClientRects().length);
  const firstChildren=(el,limit)=>{const result=[];for(let n=el.firstElementChild;n&&result.length<limit;n=n.nextElementSibling)result.push(n);return result;};
  function hitTarget(event) {
    if(!event.clientX&&!event.clientY)return event.target;
    const x=event.clientX,y=event.clientY;
    const stack=document.elementsFromPoint(x,y).filter(el=>el!==box&&el!==tag&&!el.closest('[id^="__v6"]')).slice(0,16);
    const meaningful=el=>el.matches('img,input,textarea,select,video,canvas,button,[contenteditable=true]')||Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim());
    let remaining=160;
    for(const el of stack){
      if(el===document.body||el===document.documentElement)continue;
      if(meaningful(el))return el;
      // Inspect only a bounded branch underneath the pointer; never build a
      // complete field list in the mousemove hot path.
      let best=null,area=Infinity;
      const pending=firstChildren(el,Math.min(120,remaining));
      while(pending.length&&remaining-->0){
        const node=pending.shift();
        if(node.closest('[id^="__v6"]')||/^(SCRIPT|STYLE|TEMPLATE)$/.test(node.tagName))continue;
        const r=node.getBoundingClientRect();
        if(x<r.left||x>r.right||y<r.top||y>r.bottom||!r.width||!r.height)continue;
        if(meaningful(node)&&r.width*r.height<area){best=node;area=r.width*r.height;}
        pending.push(...firstChildren(node,Math.max(0,remaining-pending.length)));
      }
      if(best)return best;
    }
    return event.target;
  }
  function elementXPath(el){
    const literal=value=>!value.includes("'")?"'"+value+"'":!value.includes('"')?'"'+value+'"':"concat("+value.split("'").map(part=>"'"+part+"'").join(',"\'",')+")";
    const unique=x=>{const r=document.evaluate(x,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);return r.snapshotLength===1&&r.snapshotItem(0)===el;};
    const tag=el.tagName.toLowerCase(),text=(el.textContent||'').trim().replace(/\s+/g,' ');
    const candidates=[];
    if(text&&text.length<80&&!['input','textarea','select'].includes(tag))candidates.push('//'+tag+'[normalize-space(.)='+literal(text)+']');
    for(const key of ['data-testid','name','placeholder','aria-label','autocomplete','type']){const value=el.getAttribute(key);if(value&&value!=='off'&&value!=='on')candidates.push('//'+tag+'[@'+key+'='+literal(value)+']');}
    for(const candidate of candidates)if(unique(candidate))return candidate;
    const parts=[];for(let n=el;n&&n.nodeType===1;n=n.parentElement){let index=1;for(let s=n.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===n.tagName)index++;parts.unshift(n.tagName.toLowerCase()+'['+index+']');}
    return '/'+parts.join('/');
  }
  const pickData=el=>({path:el===document.body?'body':v6CssPath(el,document.body),xpath:elementXPath(el),tag:el.tagName.toLowerCase(),text:(el.innerText||'').trim().slice(0,60),href:el.closest('a')?.href||null,childCount:childrenOf(el).length});
  function choose(el, mode='single', list=null, remember=true) {
    if(remember && selected) {history.push({el:selected,mode:selectionMode,list:selectionList});if(history.length>50)history.shift();}
    document.querySelectorAll('[data-v6-selected]').forEach(item=>item.removeAttribute('data-v6-selected'));
    selected=el; selectionMode=mode; selectionList=list;
    const elements=list?v6ResolveItems(list):[el];
    const childCount=childrenOf(el).length;
    elements.forEach(item=>item.setAttribute('data-v6-selected',''));
    menu.replaceChildren(); menu.style.display='block';
    const heading=document.createElement('strong');heading.textContent='✥ 操作提示';heading.style.cssText='display:block;font-size:12px;font-weight:500;margin:-12px -12px 12px;padding:8px 12px;background:#ff9800;color:#fff';menu.append(heading);v6DragTip(menu,heading);
    const info=document.createElement('div'); info.textContent=`已选中 ${elements.length} 个元素${mode==='single'?'，包含 '+childCount+' 个子元素':''}`; menu.append(info);
    const crumbs=document.createElement('div');crumbs.style.cssText='display:flex;gap:4px;flex-wrap:wrap;margin:8px 0';
    const ancestors=[];let ancestor=el;while(ancestor&&ancestor!==document.documentElement&&ancestors.length<5){ancestors.unshift(ancestor);ancestor=ancestor.parentElement;}
    ancestors.forEach((target,index)=>{const crumb=document.createElement('button');crumb.textContent=target.tagName;crumb.style.cssText='border:0;background:#f1f5fa;color:#211c15;padding:3px 5px;font:inherit;cursor:pointer';crumb.onclick=()=>choose(target);crumbs.append(crumb);});
    const actions=[['table-all','选择整张表格'],...(mode==='single'?[['children','选中全部子元素'],['list','选中全部相似元素']]:[]),['extract-text','文本内容'],['extract-innerHtml','InnerHtml'],['extract-html','OuterHtml'],...(el.closest('a[href]')?[['extract-href','链接地址']]:[]),...(el.tagName==='IMG'?[['extract-img','图片地址']]:[]),...(mode!=='single'?[['extract-auto','元素中数据内容']]:[]),['action-click','点击一次'],['action-hover','移动到元素上'],['action-loop','循环点击'],['parent','选择外层'],['back','返回选择'],['cancel','取消选择']];
    if(el.firstElementChild)actions.unshift(['fields','展开内部字段']);
    if(mode==='fields'||mode==='multi')actions.unshift(['list','选中全部相似元素']);
    if(editable(el))actions.unshift(['action-input','输入文本'],['extract-value','文本框内的值']);
    actions.splice(actions.length-3,0,['action-next','循环点击下一页'],['action-captcha','识别验证码']);
    const similarAction=actions.find(item=>item[0]==='list');
    if(similarAction){similarAction[1]='找出全部相似';actions.splice(actions.indexOf(similarAction),1);actions.unshift(similarAction);}
    if(mode==='similar')actions.splice(0,actions.length,['extract-auto','元素中数据内容'],['back','返回选择'],['cancel','取消']);
    const groups=new Map();
    for(const [action,label] of actions) {
      const group=action.startsWith('extract-')?'提取数据':action.startsWith('action-')?(action==='action-input'?'输入编辑':'鼠标操作'):['back','cancel','parent'].includes(action)?'选择操作':'选择元素';
      if(!groups.has(group)){
        const section=document.createElement('div');section.style.cssText='border-top:1px solid #eee;margin-top:10px;padding-top:8px';
        const title=document.createElement('div');title.textContent=group;title.style.cssText='color:#666;margin-bottom:6px';section.append(title);groups.set(group,section);
      }
      const button=document.createElement('button');button.textContent=label;
      button.dataset.action=action;
      if(action==='list'||action==='extract-auto')button.dataset.primary='';
      button.style.cssText='font:inherit;display:inline-block;width:calc(50% - 4px);box-sizing:border-box;vertical-align:top;text-align:left;margin:4px 4px 0 0;padding:5px 2px;border:0;border-radius:3px;background:transparent;color:#3478ff;white-space:nowrap;cursor:pointer';
      button.disabled=action==='children'&&!childCount || action==='parent'&&(!el.parentElement||el===document.body);
      if(action==='back')button.disabled=!history.length;
      button.onclick=()=>{
        if(action==='action-input'){inputEditor(el);return;}
        if(action==='action-captcha'){
          menu.replaceChildren();const title=document.createElement('p');title.textContent='验证码类型（人工处理后继续）';
          const select=document.createElement('select');[['图片验证码','image'],['滑块拼图','slider'],['点选文字','text']].forEach(([label,value])=>select.add(new Option(label,value)));
          const confirm=document.createElement('button');confirm.textContent='添加步骤';confirm.dataset.primary='';confirm.onclick=()=>{window.__v6?.send('record-captcha',{selector:pickData(el).path,kind:select.value});menu.style.display='none';};
          const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>choose(el);const footer=document.createElement('div');footer.className='prompt-actions';footer.append(cancel,confirm);
          menu.append(title,select,footer);return;
        }
        if(action==='fields'){const nodes=fieldsOf(el);choose(el,'fields',{type:'css',selector:nodes.map(n=>pickData(n).path).join(',')});return;}
        if(action==='parent') {choose(el.parentElement);return;}
        if(action==='back') {const prev=history.pop();if(prev)choose(prev.el,prev.mode,prev.list,false);return;}
        if(action==='children') {choose(el,'children',{type:'css',selector:pickData(el).path+' > :not(script):not(style):not(template):not(meta):not(link)'});return;}
        if(action==='list') {
          if(selectionMode==='multi'){
            let root=document.querySelector(selectionList.list.selector);
            for(let depth=0;root&&root!==document.body&&depth<6;depth++,root=root.parentElement){
              const parent=root.parentElement,cls=v6StableClass(root);
              const rows={type:'siblings',parentPath:pickData(parent).path,tag:root.tagName,cls:cls||''};
              if(v6ResolveItems(rows).length<2)continue;
              const fields=v6ResolveItems(selectionList).map(node=>({rel:node===root?':scope':v6CssPath(node,root),type:node.tagName==='IMG'?'img':editable(node)?'value':'text'}));
              choose(el,'similar',{type:'fieldSelection',list:rows,fields});return;
            }
            choose(el,'similar',selectionList);return;
          }
          const parent=el.parentElement,cls=v6StableClass(el);
          let list=parent?{type:'siblings',parentPath:pickData(parent).path,tag:el.tagName,cls:cls||''}:null;
          // A title/price is often the only child of its immediate wrapper.
          // Generalize its relative path inside repeated ancestor cards.
          if(list&&v6ResolveItems(list).length<2){
            let ancestor=parent;
            for(let depth=0;ancestor&&ancestor!==document.body&&depth<6;depth++,ancestor=ancestor.parentElement){
              const container=ancestor.parentElement;if(!container)break;
              const shared=v6StableClass(ancestor),siblings=Array.from(container.children).filter(n=>n.tagName===ancestor.tagName&&(!shared||n.classList.contains(shared)));
              if(siblings.length<2)continue;
              const rel=v6CssPath(el,ancestor);if(!rel)continue;
              const base=pickData(container).path+' > '+ancestor.tagName.toLowerCase()+(shared?'.'+CSS.escape(shared):'');
              const candidate={type:'css',selector:base+' > '+rel};
              if(v6ResolveItems(candidate).length>=2){list=candidate;break;}
            }
          }
          if(list)choose(el,'similar',list);
          return;
        }
        if(action==='cancel'){
          document.querySelectorAll('[data-v6-selected]').forEach(item=>item.removeAttribute('data-v6-selected'));
          selected=null;selectionList=null;history.length=0;menu.style.display='none';return;
        }
        window.__v6?.send('pick-action',{...pickData(selected),role:action,selectionList:selectionMode==='fields'&&action==='extract-auto'?null:selectionList});
        menu.style.display='none';
      };
      groups.get(group).append(button);
    }
    for(const [group,section] of groups)if(group!=='选择操作')menu.append(section);
    menu.append(crumbs);
    if(groups.has('选择操作'))menu.append(groups.get('选择操作'));
    window.__v6?.send('pick',pickData(el));
  }
  let cur = null;
  let moveFrame=0,pendingMove=null;
  const paintMove = e => {
    if (!e.target.isConnected || e.target === box || e.target === tag || menu.contains(e.target) || e.target.closest?.('#__v6-guide,#__v6-optip')) {box.style.display='none';tag.style.display='none';return;}
    cur = hitTarget(e);
    const r = cur.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    tag.style.display = 'block';
    const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    tag.textContent = cur.tagName.toLowerCase() + (cls ? '.' + cls : '');
    tag.style.left = r.left + 'px';
    tag.style.top = Math.max(0, r.top - 21) + 'px';
  };
  const move=e=>{
    pendingMove={target:e.target,clientX:e.clientX,clientY:e.clientY};
    if(moveFrame)return;
    moveFrame=requestAnimationFrame(()=>{moveFrame=0;paintMove(pendingMove);});
  };
  const click = e => {
    if (e.target === box || e.target === tag || menu.contains(e.target) || e.target.closest?.('#__v6-guide,#__v6-optip')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    cur = hitTarget(e);
    if(inputDraft){if(editable(cur))inputEditor(cur);return;}
    if(selected&&['single','multi'].includes(selectionMode)&&!editable(cur)&&!editable(selected)){
      const nodes=(selectionMode==='multi'?v6ResolveItems(selectionList):[selected]).filter(n=>n.isConnected);
      const index=nodes.indexOf(cur);
      if(index>=0)nodes.splice(index,1);else nodes.push(cur);
      if(!nodes.length){document.querySelectorAll('[data-v6-selected]').forEach(n=>n.removeAttribute('data-v6-selected'));selected=null;selectionList=null;menu.style.display='none';return;}
      if(nodes.length===1){choose(nodes[0]);return;}
      let root=nodes[0];while(root&&!nodes.every(n=>root.contains(n)))root=root.parentElement;
      const fields=nodes.map(n=>({rel:n===root?':scope':v6CssPath(n,root),type:n.tagName==='IMG'?'img':editable(n)?'value':'text'}));
      choose(cur,'multi',{type:'fieldSelection',list:{type:'css',selector:pickData(root).path},fields});return;
    }
    choose(cur);
  };
  const key = e => {
    if (e.key === 'Escape') { v6PickMode(false); window.__v6 && window.__v6.send('pick-off', {}); }
  };
  const down = e => { if (e.target !== box && e.target !== tag && !menu.contains(e.target) && !e.target.closest?.('#__v6-guide,#__v6-optip')) { e.preventDefault(); e.stopPropagation(); } };
  const scrolled=()=>{box.style.display='none';tag.style.display='none';};
  window.addEventListener('scroll',scrolled,true);
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('mousedown', down, true);
  window.addEventListener('keydown', key, true);
  window.__v6pick = {
    off() {
      if(moveFrame)cancelAnimationFrame(moveFrame);
      window.removeEventListener('scroll',scrolled,true);
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      box.remove(); tag.remove(); menu.remove(); selectedStyle.remove();
      document.querySelectorAll('[data-v6-selected]').forEach(item=>item.removeAttribute('data-v6-selected'));
    },
  };
  return { on: true };
}

// --- 解析点选结果（列表项 / 字段 / 下一页） ---
function v6ResolvePick(path, role, cfg, selectionList) {
  let el = null;
  try { el = document.querySelector(path); } catch (e) {}
  if (!el) return { ok: false, error: '未找到该元素，页面可能已变化' };
  if(selectionList){
    const source=selectionList.type==='fieldSelection'?selectionList.list:selectionList;
    const items=v6ResolveItems(source);
    if(items.length>1){
      const stable=v6StableList(items[0]);
      const matches=stable?v6ResolveItems(stable):[];
      // 仅保留同层级的已选记录，不能把字段节点提升成整张卡片。
      if(stable&&items.every(item=>matches.includes(item))){
        selectionList=selectionList.type==='fieldSelection'?{...selectionList,list:stable}:stable;
      }
    }
  }
  if(role.startsWith('extract-')) {
    const type=role.slice(8);
    if(!['text','innerHtml','html','href','img','value','auto'].includes(type))return {ok:false,error:'未知提取类型'};
    if(selectionList?.type==='fieldSelection'){
      const list=selectionList.list,items=v6ResolveItems(list);
      const fields=selectionList.fields.map((f,i)=>({...f,type:type==='auto'?f.type:type,name:'字段'+(i+1)}));
      return {ok:true,list,fields,count:items.length,samples:items.slice(0,3).map(item=>v6ExtractRow(item,fields))};
    }
    const existing=cfg?.list?v6ResolveItems(cfg.list):[];
    const item=existing.find(item=>item===el||item.contains(el));
    if(!selectionList && item && type!=='auto') {
      const fields=(cfg.fields||[]).slice();
      const rel=item===el?':scope':v6CssPath(el,item);
      if(!fields.some(field=>field.rel===rel&&field.type===type)) fields.push({name:'字段'+(fields.length+1),type,rel});
      return {ok:true,list:cfg.list,fields,count:existing.length,samples:existing.slice(0,3).map(item=>v6ExtractRow(item,fields))};
    }
    const list=selectionList||{type:'css',selector:path};
    const items=v6ResolveItems(list);
    const fields=type==='auto'?v6AlignFields(items):[{name:'字段1',type,rel:':scope'}];
    return {ok:true,list,fields,count:items.length,samples:items.slice(0,3).map(item=>v6ExtractRow(item,fields))};
  }
  if (role === 'next') return { ok: true, nextSel: path, text: (el.innerText || '').trim().slice(0, 20) };
  if (role === 'children') {
    const list={type:'css',selector:(el===document.body?'body':v6CssPath(el,document.body))+' > :not(script):not(style):not(template):not(meta):not(link)'};
    const items=v6ResolveItems(list);
    if(!items.length) return {ok:false,error:'此元素没有可选择的子元素'};
    const fields=v6AlignFields(items);
    return {ok:true,list,count:items.length,fields,samples:items.slice(0,3).map(item=>v6ExtractRow(item,fields))};
  }

  if (role === 'list') {
    const stable=v6StableList(el);
    if(stable){const resolved=v6ResolveItems(stable);const fields=v6AlignFields(resolved);return {ok:true,list:stable,count:resolved.length,fields,samples:resolved.slice(0,3).map(it=>v6ExtractRow(it,fields))};}
    const p = el.parentElement;
    if (!p || p === document.documentElement) return { ok: false, error: '该元素无法作为列表项（无父容器）' };
    const tag = el.tagName;
    const cls = v6StableClass(el) || '';
    const items = Array.from(p.children).filter(c => c.tagName === tag && (!cls || c.classList.contains(cls)));
    let list;
    if (items.length >= 2) {
      list = { type: 'siblings', parentPath: v6CssPath(p, document.body), tag, cls };
    } else {
      // 兄弟不同 → 尝试全局同类
      const globals = cls ? Array.from(document.querySelectorAll(tag + '.' + cls)) : [];
      if (globals.length < 2) return { ok: false, error: '未找到相似条目，请点选列表里的一条完整记录' };
      list = { type: 'sig', tag, cls };
    }
    const resolved = v6ResolveItems(list);
    if (!resolved.length) return { ok: false, error: '列表解析失败' };
    const fields = v6AlignFields(resolved);
    return {
      ok: true, list,
      count: resolved.length,
      fields,
      samples: resolved.slice(0, 3).map(it => v6ExtractRow(it, fields)),
    };
  }

  if (role === 'field') {
    const items = cfg && cfg.list ? v6ResolveItems(cfg.list) : [];
    let item = el;
    while (item && item !== document.body && !items.includes(item)) item = item.parentElement;
    if (!items.includes(item)) return { ok: false, error: '请先选好列表（自动识别或点选列表项），再点选字段' };
    const fields = (cfg && cfg.fields ? cfg.fields.slice() : []);
    if (fields.some(f => f.rel === v6CssPath(el, item))) return { ok: false, error: '该字段已存在' };
    const f = {
      name: v6SmartName(el, fields.length, fields),
      type: el.tagName === 'IMG' ? 'img' : 'text',
      rel: v6CssPath(el, item),
      __idx: v6FieldNodes(item).indexOf(el),
      sample: (el.tagName === 'IMG' ? (el.getAttribute('src') || '') : (el.innerText || '').trim().slice(0, 50)),
    };
    fields.push(f);
    return { ok: true, field: f, fields, samples: [v6ExtractRow(item, fields)] };
  }
  return { ok: false, error: '未知角色 ' + role };
}

// --- 统计条目数（翻页后校验选择器是否仍有效） ---
function v6CountItems(cfg) {
  try{
    if(cfg.list?.type==='css')document.querySelectorAll(cfg.list.selector);
    if(cfg.list?.type==='xpath')document.evaluate(cfg.list.selector,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
  }catch(error){return {ok:false,code:'INVALID_SELECTOR',error:'列表定位无效：'+error.message};}
  const items = cfg && cfg.list ? v6ResolveItems(cfg.list) : [];
  return { count: items.length, first: items.length ? (items[0].innerText || '').trim().slice(0, 80) : '' };
}

// 试提取只读取当前页，不滚动、不翻页；先报告定位错误，避免把无效配置当成空数据。
function v6Preview(cfg) {
  try {
    if (!cfg.list) return { ok: false, error: '尚未配置列表' };
    if (['css','xpath'].includes(cfg.list.type)&&!cfg.list.selector?.trim()) return {ok:false,error:'请先通过列表 XPath 旁的图标选择表格'};
    if (cfg.list.type === 'css') document.querySelectorAll(cfg.list.selector);
    if (cfg.list.type === 'xpath') document.evaluate(cfg.list.selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const items = v6ResolveItems(cfg.list);
    if (!items.length) return { ok: false, error: '列表选择器没有匹配到元素' };
    for (const field of cfg.fields) {
      if (field.xpath) document.evaluate(field.xpath, items[0], null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      else if (field.rel && field.rel !== ':scope') items[0].querySelector(field.rel);
    }
    return { count: items.length, rows: items.slice(0, 100).map(item => v6ExtractRow(item, cfg.fields)) };
  } catch (error) { return { ok: false, error: '定位无效：' + error.message }; }
}

// Capture strings only, once per owning list, before any child replaces this document.
function v6LoopUrls(list, descriptors, count, sourceUrl) {
  const items = v6ResolveItems(list);
  return Array.from({length:count}, (_, index) => Object.fromEntries(descriptors.map(spec => {
    try {
      if (spec.error) throw Error(spec.error);
      const item = items[index];
      if (!item) throw Error('循环网址定位失败：当前循环元素已不存在');
      const link = spec.field ? null : item.closest('a[href]') || item.querySelector('a[href]');
      const href = String(spec.field ? v6ExtractRow(item, [spec.field])[0] : link?.href || '').trim();
      if (!href) throw Error('当前循环元素没有网址，请配置链接或选择循环网址字段');
      const url = new URL(href, sourceUrl).href;
      if (!/^https?:\/\//i.test(url)) throw Error('循环网址必须是 http 或 https 网址');
      return [spec.id, {url}];
    } catch (error) { return [spec.id, {error:error.message}]; }
  })));
}

function v6FlowAction(action, cfg, itemIndex) {
  const p = action.params || {};
  const item = itemIndex == null ? null : v6ResolveItems(cfg.list)[itemIndex];
  if (itemIndex != null && !item) return { ok: false, error: '当前循环元素已不存在' };
  if (action.type === 'extract') {
    return { rows: (item ? [item] : v6ResolveItems(cfg.list)).map(el => v6ExtractRow(el, cfg.fields)) };
  }
  if (action.type === 'scroll' || action.type==='scrollLoop') {
    const region=p.selector?(p.mode==='xpath'?document.evaluate(p.selector,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue:document.querySelector(p.selector)):document.scrollingElement;
    if(!region)return {ok:false,error:'未找到滚动区域'};
    region.scrollTo({top:p.bottom?region.scrollHeight:region.scrollTop+Number(p.pixels??region.clientHeight),behavior:'instant'});
    return { ok: true };
  }
  const scope = p.relative && item ? item : document;
  let target;
  const interactive=['click','input','hover','select'].includes(action.type);
  const visible=el=>el.nodeType===1&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  try {
    target = p.selector ? (p.mode === 'xpath'
      ? document.evaluate(p.selector, scope, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      : p.selector === ':scope' && item ? item : scope.querySelector(p.selector)) : item;
    if(interactive&&p.selector&&p.selector!==':scope'){
      let matches;
      if(p.mode==='xpath'){
        const r=document.evaluate(p.selector,scope,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
        matches=Array.from({length:r.snapshotLength},(_,i)=>r.snapshotItem(i));
      }else matches=Array.from(scope.querySelectorAll(p.selector));
      const shown=matches.filter(visible);
      if(shown.length>1)return {ok:false,error:'定位匹配多个可见元素（'+shown.length+' 个），请缩小定位范围：'+p.selector};
      if(shown.length)target=shown[0];
    }
  } catch (error) { return { ok: false, error: '节点定位无效：' + error.message }; }
  if(action.type==='condition')return {exists:!!target,text:target?.textContent||''};
  if (!target) return { ok: false, retryable:true, missing:true, error: '节点未匹配元素；定位：'+(p.selector||'未设置')+(/(?:el-id-|headlessui-|radix-)/.test(p.selector||'')?'。该规则使用组件动态 ID，请重新点选元素并应用、保存。':'。请检查当前页面及前置步骤。') };
  if(interactive){
    if(!visible(target))return {ok:false,retryable:true,missing:true,error:'目标元素尚未显示'};
    if(target.disabled||target.getAttribute('aria-disabled')==='true'||action.type==='input'&&target.readOnly)return {ok:false,retryable:true,error:'目标控件尚未启用'};
    target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const rect=target.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2)),y=Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2));
    const hit=document.elementFromPoint(x,y);
    if(hit&&hit!==target&&!target.contains(hit))return {ok:false,retryable:true,error:'目标元素被其他内容遮挡'};
  }
  if(action.type==='select') {
    if(target.tagName!=='SELECT')return {ok:false,error:'请选择原生下拉框'};
    const option=Array.from(target.options).find(o=>o.value===String(p.value)||o.text===String(p.value));
    if(!option)return {ok:false,error:'下拉框没有该选项'};
    target.value=option.value;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};
  }
  if (action.type === 'hover') {
    target.scrollIntoView({block:'center'});
    const rect=target.getBoundingClientRect();
    for(const type of ['mouseover','mouseenter','mousemove'])target.dispatchEvent(new MouseEvent(type,{bubbles:type!=='mouseenter',clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
    return {ok:true};
  }
  if (action.type === 'detail') {
    const link = target.closest('a[href]') || target.querySelector('a[href]');
    if (!link || !/^https?:\/\//i.test(link.href)) return { ok: false, error: '请选择带有 http 或 https 地址的详情链接' };
    return { href: link.href, scrollX: window.scrollX, scrollY: window.scrollY };
  }
  if (action.type === 'input') {
    if (!/^(INPUT|TEXTAREA)$/.test(target.tagName)&&!target.isContentEditable) return { ok: false, error: '请选择可输入的控件' };
    if(target.disabled||target.readOnly)return {ok:false,error:'输入框已禁用或只读'};
    if(p.focus){target.scrollIntoView({block:'center'});target.focus();}
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
    if (setter) setter.call(target, String(p.value ?? ''));
    else if(target.isContentEditable)target.textContent=String(p.value ?? '');
    else target.value = String(p.value ?? '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  target.click();
  return { ok: true };
}

// --- 采集一页：滚动加载 + 边滚边采 ---
async function v6ScrollCollect(cfg, opts) {
  if(cfg.list?.genericGrid)return genericTable(cfg,opts);
  if(cfg.list?.virtualGrid)return collectVirtualTable(cfg,opts);
  opts = opts || {};
  window.__v6collectStopped = false;
  const sleep = async ms => {
    const end = Date.now() + ms;
    while (!window.__v6collectStopped && Date.now() < end) await new Promise(r => setTimeout(r, Math.min(30, end - Date.now())));
  };
  const rows = [];
  const seen = new Set();
  const logicalRows=new Map(),scopeIds=new WeakMap(),rowLimit=Math.max(1,Number(opts.maxRows)||200000);
  let nextScope=0;
  function harvest() {
    let added = 0;
    const scopes=opts.dedupe===false?scrollables():[];
    for (const it of v6ResolveItems(cfg.list)) {
      if(rows.length>=rowLimit)break;
      const vals = v6ExtractRow(it, cfg.fields);
      const key = opts.dedupe!==false?JSON.stringify(vals):null;
      let logicalKey;
      if(opts.dedupe===false){
        const scope=scopes.findLast(item=>item.el.contains(it))?.el||document.scrollingElement||document.documentElement;
        if(!scopeIds.has(scope))scopeIds.set(scope,++nextScope);
        const rowId=['data-row-key','data-row-id','row-id','rowid','aria-rowindex','data-index','data-row-index','id'].map(name=>[name,it.getAttribute(name)]).find(([,value])=>value!==null&&value!=='');
        let identity=rowId;
        if(!identity){const rect=it.getBoundingClientRect(),origin=scope===document.scrollingElement?{left:0,top:0}:scope.getBoundingClientRect();identity=[Math.round(rect.left-origin.left+scope.scrollLeft),Math.round(rect.top-origin.top+scope.scrollTop)];}
        logicalKey=JSON.stringify([scopeIds.get(scope),identity]);
        const existing=logicalRows.get(logicalKey);
        if(existing!==undefined){rows[existing]=vals;continue;}
      }
      if (opts.dedupe!==false && seen.has(key)) continue;
      if(opts.dedupe!==false)seen.add(key);
      if(logicalKey!==undefined)logicalRows.set(logicalKey,rows.length);
      rows.push(vals);
      added++;
    }
    return added;
  }
  function scrollables() {
    const list = [];
    const se = document.scrollingElement;
    if (se && se.scrollHeight > se.clientHeight + 60) list.push({ el: se, kind: 'main' });
    // Only the configured list's ancestors can load its hidden rows. Searching
    // the whole DOM on every round also scrolled unrelated navigation menus.
    const items=v6ResolveItems(cfg.list),candidates=new Set();
    const sample=items.length<=12?items:Array.from({length:12},(_,i)=>items[Math.floor(i*(items.length-1)/11)]);
    for(const item of sample)for(let el=item;el&&el!==document.documentElement;el=el.parentElement)candidates.add(el);
    let inner = 0;
    for (const el of candidates) {
      if (inner >= 4) break;
      if (el === se || !el.clientHeight && !el.clientWidth) continue;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 60 && el.clientHeight > 120) {
        list.push({ el, kind: 'innerY' }); inner++;
      } else if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 60 && el.clientWidth > 120) {
        list.push({ el, kind: 'innerX' }); inner++;
      }
    }
    return list;
  }
  harvest();
  if (opts.scrollLoad === false){return { rows, rounds: 0, ms: 0, reason:rows.length>=rowLimit?'达到数据条数上限':'已关闭滚动加载' };}
  let t0 = Date.now();
  const maxMs = (opts.maxScrollSec ?? 40) * 1000;
  const wait = opts.scrollWait ?? 700;
  let unchanged = 0;
  let round = 0;
  let reason='达到滚动时间上限',lastGeometry='';
  while (!window.__v6collectStopped && Date.now() - t0 < maxMs) {
    if(window.__v6collectStopped)break;
    round++;
    const before = rows.length;
    const scs = scrollables();
    if (!scs.length) {reason='页面没有可滚动区域';break;}
    for (const sc of scs) {
      if (sc.kind === 'innerX') {
        if (sc.el.scrollLeft + sc.el.clientWidth < sc.el.scrollWidth - 5) {
          sc.el.scrollLeft += Math.round(sc.el.clientWidth * 0.8);
        }
      } else {
        const atEnd = sc.el.scrollTop + sc.el.clientHeight >= sc.el.scrollHeight - 5;
        if (atEnd) {
          // 到底后保留位置，等待内容更新，不能回到顶部再循环。
          // 主滚动到顶底就等加载，不动作
        } else {
          sc.el.scrollTop += Math.round(sc.el.clientHeight * 0.8);
        }
      }
    }
    await sleep(wait);
    if (window.__v6collectStopped) break;
    // 主页面已滚到底时多等一拍，给懒加载/无限加载留出渲染时间
    const mainSc = scs.find(s => s.kind === 'main');
    if (mainSc && mainSc.el.scrollTop + mainSc.el.clientHeight >= mainSc.el.scrollHeight - 5) {
      await sleep(wait);
    }
    if (window.__v6collectStopped) break;
    harvest();
    const regions=scrollables();
    const atEnd=regions.every(sc=>sc.kind==='innerX'?sc.el.scrollLeft+sc.el.clientWidth>=sc.el.scrollWidth-5:sc.el.scrollTop+sc.el.clientHeight>=sc.el.scrollHeight-5);
    const geometry=regions.map(sc=>sc.el.scrollHeight+':'+sc.el.scrollWidth).join('|');
    unchanged = atEnd && rows.length === before && geometry===lastGeometry ? unchanged + 1 : 0;
    lastGeometry=geometry;
    window.__v6?.send('collect-progress',{round,rows:rows.length,seconds:Math.round((Date.now()-t0)/1000),atEnd,stable:unchanged});
    if (unchanged >= 3) {reason='所有滚动区域到底且连续三轮无新增';break;}
    if (rows.length >= rowLimit) {reason='达到数据条数上限';break;}
  }
  if(window.__v6collectStopped)reason='用户停止';
  return { rows, rounds: round, ms: Date.now() - t0, reason };
}

// --- 查找/点击"下一页" ---
function v6ClickNext(sel, document = window.document) {
  if(sel?.inFrame){
    const frame=document.evaluate(sel.frameXPath,document,null,9,null).singleNodeValue;
    if(!frame)throw Error('未找到翻页 iframe');
    document=frame.contentDocument;
    if(!document)throw Error('无法访问翻页 iframe，请确认页面已加载且 iframe 与页面同源');
  }
  let el = null;
  if (sel) {
    try {
      el = typeof sel === 'object' && sel.type === 'xpath'
        ? document.evaluate(sel.selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        : document.querySelector(typeof sel === 'object' ? sel.selector : sel);
    } catch (e) { return { ok: false, error: '下一页选择器无效（'+(sel.type||'css')+'）：请确认定位方式与表达式一致；XPath 必须返回元素，不能是布尔值、数字或字符串。原始错误：' + e.message }; }
    if (!el) return { ok: false, error: '没有匹配指定的下一页元素' };
  }
  if (!el) {
    const neg = ['上一页', '前页', 'prev', 'previous', '«', '‹', '<', '首页', '末页', 'last', '第一页'];
    const cands = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], li, span, div'))
      .filter(e => {
        if (e.offsetParent === null) return false;
        const raw = (e.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!raw || raw.length > 12) return false;
        if (neg.some(n => raw === n)) return false;
        const hitText = raw === '下一页' || raw.startsWith('下一页') || raw === 'next' || raw.startsWith('next ')
          || raw === '›' || raw === '»' || raw === '>' || raw === '下页' || raw === '后一页' || raw === '→';
        const hitCls = /(^|[\s_-])(next|pagedown|pagination[_-]?next)([\s_-]|$)/.test((e.className || '').toString().toLowerCase());
        return hitText || hitCls;
      });
    const score = e => {
      let s = 0;
      const t = (e.innerText || '').trim().toLowerCase();
      if (t === '下一页' || t === 'next' || t.startsWith('下一页')) s += 3;
      if (e.tagName === 'A' && e.getAttribute('href') && e.getAttribute('href') !== '#') s += 2;
      if (e.tagName === 'BUTTON') s += 1;
      return s;
    };
    cands.sort((a, b) => score(b) - score(a));
    el = document.querySelector('a[rel="next"]') || cands[0] || null;
  }
  if (!el) return { ok: false, error: 'not found' };
  // 候选是容器时，优先找它内部的真正链接
  if (!(el.tagName === 'A' && el.getAttribute('href'))) {
    const inner = el.querySelector ? el.querySelector('a[href]') : null;
    if (inner) el = inner;
  }
  const a = el.tagName === 'A' ? el : (el.closest ? el.closest('a[href]') : null);
  const href = a ? a.href : null;
  // 有真实链接 → 交给主进程直接导航（比页内点击更可靠）；否则页内点击（SPA 按钮）
  if (href && /^https?:/.test(href) && !sel?.inFrame) return { ok: true, mode: 'nav', href, text: (el.innerText || '').trim().slice(0, 20) };
  try {
    el.scrollIntoView({ block: 'center' });
    el.click();
  } catch (e) { return { ok: false, error: String(e) }; }
  return { ok: true, mode: 'click', href: null, text: (el.innerText || '').trim().slice(0, 20) };
}

// 注入包装：全部函数收进一个 IIFE，返回一个可直接 (args)=>调用的包装函数，
// 由 main/orchestrator 的 exec 通过 `(code)(args)` 的形式传参调用。
function build(fns, entry) {
  const src = [readTableCell,genericTable,...fns].map(f => f.toString()).join('\n');
  const theme=['v6PickMode','v6Captcha'].includes(entry)?'const v6ControlCss='+JSON.stringify(controlCss)+';\n':'';
  return '(function(){\n' + theme + src +
    '\nreturn function(){ try { return ' + entry + '.apply(null, arguments); }' +
    ' catch (e) { return { ok: false, error: ' + JSON.stringify(entry) + ' + ": " + e.message }; } };\n})()';
}

// --- 「操作提示」浮窗（八爪鱼式，浮在页面右上角，与外壳同一套设计语言） ---
function v6DragTip(box,header){
  window.__v6DragController?.abort();const controller=new AbortController();window.__v6DragController=controller;const signal=controller.signal;
  const place=(x,y)=>{const r=box.getBoundingClientRect();const pos={x:Math.max(0,Math.min(x,innerWidth-r.width)),y:Math.max(0,Math.min(y,innerHeight-r.height))};box.style.left=pos.x+'px';box.style.top=pos.y+'px';box.style.right='auto';window.__v6TipPosition=pos;};
  if(window.__v6TipPosition)place(window.__v6TipPosition.x,window.__v6TipPosition.y);
  window.addEventListener('resize',()=>{if(box.isConnected&&window.__v6TipPosition)place(window.__v6TipPosition.x,window.__v6TipPosition.y);},{signal});
  header.style.cursor='move';header.style.touchAction='none';header.style.userSelect='none';
  let drag=null,moved=false;
  header.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;const r=box.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:r.left,top:r.top};moved=false;header.setPointerCapture(event.pointerId);event.stopPropagation();});
  window.addEventListener('pointermove',event=>{if(!drag)return;const x=event.clientX-drag.x,y=event.clientY-drag.y;if(Math.abs(x)+Math.abs(y)>3)moved=true;if(moved)place(drag.left+x,drag.top+y);},{signal});
  window.addEventListener('pointerup',()=>{drag=null;},{signal});window.addEventListener('pointercancel',()=>{drag=null;moved=false;},{signal});
  box.addEventListener('click',event=>{if(moved){event.preventDefault();event.stopImmediatePropagation();moved=false;}},{capture:true,signal});
}
function v6OpTip(action) {
  const id = '__v6-optip';
  const old = document.getElementById(id);
  if (old) old.remove();
  if (action !== 'show') return { on: false };
  if (window.__v6tipDismissed) return { on: false };
  const collapsed = !!window.__v6tipCollapsed;
  const tip = document.createElement('div');
  tip.id = id;
  tip.innerHTML =
    '<style>' +
    '#' + id + '{position:fixed;top:14px;right:14px;width:280px;background:#fff;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.08),0 3px 6px -4px rgba(0,0,0,.12),0 9px 28px 8px rgba(0,0,0,.05);z-index:2147483640;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";color:#211c15;overflow:hidden;border:1px solid #f0f0f0}' +
    '#' + id + ' .hd{display:flex;align-items:center;gap:8px;background:#1677ff;color:#fff;font-weight:600;font-size:13px;padding:8px 12px;cursor:pointer;user-select:none}' +
    '#' + id + ' .hd .dot{width:6px;height:6px;border-radius:50%;background:#fff}' +
    '#' + id + ' .hd .arr{margin-left:auto;font-size:10px;opacity:.9;transform:rotate(180deg);transition:transform .15s}' +
    '#' + id + '.closed .hd .arr{transform:rotate(0)}' +
    '#' + id + ' .x{margin-left:4px;background:none;border:none;cursor:pointer;color:#fff;opacity:.85;font-size:15px;line-height:1;padding:0 2px}' +
    '#' + id + ' .x:hover{opacity:1}' +
    '#' + id + ' .bd{padding:10px 13px;color:rgba(0,0,0,.65);background:#f0f7ff}' +
    '#' + id + ' .bd b{color:rgba(0,0,0,.88)}' +
    '#' + id + ' .it{display:flex;align-items:center;gap:9px;padding:9px 13px;border-top:1px solid #f0f0f0;cursor:pointer;color:rgba(0,0,0,.88);transition:background .12s}' +
    '#' + id + ' .it:hover{background:#f0f7ff}' +
    '#' + id + ' .it svg{width:14px;height:14px;flex:none;fill:none;stroke:#1677ff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '#' + id + ' .it small{margin-left:auto;color:rgba(0,0,0,.45);font-size:11px}' +
    '</style>' +
    '<div class="hd"><span class="dot"></span>操作提示<button class="x" data-x="1">×</button><span class="arr">▼</span></div>' +
    (collapsed ? '' :
      '<div class="bd">通过<b>鼠标点选</b>网页内容，或点击下方"自动识别"，识别后自动在页面框选数据。如需登录请先在页面中直接登录。</div>' +
      '<div class="it" data-act="login"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>登录网站<small>直接在页面登录</small></div>' +
      '<div class="it" data-act="detect"><svg viewBox="0 0 24 24"><path d="M5 21l9-9M15 4V2M15 16v-2M8 9H6M22 9h-2M18.4 11.4L19.8 12.8M18.4 6.6L19.8 5.2M11.6 6.6L10.2 5.2M11.6 11.4L10.2 12.8"/></svg>自动识别网页内容<small>推荐</small></div>');
  document.documentElement.appendChild(tip);
  v6DragTip(tip,tip.querySelector('.hd'));
  tip.addEventListener('click', e => {
    e.stopPropagation();
    const x = e.target.closest('[data-x]');
    if (x) {
      window.__v6tipDismissed = true;
      window.__v6 && window.__v6.send('optip', { action: 'dismiss' });
      tip.remove();
      return;
    }
    const it = e.target.closest('[data-act]');
    if (it) {
      window.__v6tipCollapsed = true;
      window.__v6 && window.__v6.send('optip', { action: it.dataset.act });
      v6OpTip('show');
      return;
    }
    if (e.target.closest('.hd')) {
      window.__v6tipCollapsed = !window.__v6tipCollapsed;
      v6OpTip('show');
    }
  }, true);
  tip.addEventListener('mousedown', e => e.stopPropagation(), true);
  return { on: true, collapsed };
}

function v6DetailSelector(path,list){
  const target=document.querySelector(path),item=v6ResolveItems(list).find(el=>el.contains(target));
  if(!item||!target)return {ok:false,error:'请在已配置的列表项内选择详情链接'};
  const link=target.closest('a[href]');
  if(!link||!item.contains(link))return {ok:false,error:'请选择列表项内带有地址的链接'};
  return {selector:link===item?':scope':v6CssPath(link,item)};
}

// 仅用于用户明确要求选择相似列表时，不自动扩大单个元素的提取范围。
function v6StableList(el) {
  for(let item=el,depth=0;item&&item!==document.body&&depth<5;item=item.parentElement,depth++){
    for(const cls of Array.from(item.classList||[])){
      if(v6StableClass({classList:[cls]})!==cls)continue;
      const key='.'+CSS.escape(cls);
      for(let container=item.parentElement,level=0;container&&container!==document.body&&level<5;container=container.parentElement,level++){
        const matches=Array.from(container.querySelectorAll(key));
        if(matches.length<2||matches.length>1000||matches.some(n=>matches.some(other=>other!==n&&other.contains(n))))continue;
        // 限定最近有稳定标识的列表容器，允许卡片标签为 a 或 div。
        const scope=container.id?'#'+CSS.escape(container.id):v6StableClass(container)?'.'+CSS.escape(v6StableClass(container)):null;
        if(!scope||document.querySelectorAll(scope).length!==1)continue;
        return {type:'css',selector:scope+' '+key};
      }
    }
  }
  return null;
}
function v6Guide(state){
  const previous=document.getElementById('__v6-guide');
  const collapsed=previous?.dataset.phase===state?.phase&&previous?.dataset.collapsed==='true';
  document.getElementById('__v6-guide')?.remove();
  if(!state?.phase)return {ok:true,visible:false};
  document.getElementById('__v6-optip')?.remove();
  const box=document.createElement('section');box.id='__v6-guide';box.dataset.phase=state.phase;box.dataset.collapsed=String(collapsed);
  box.style.cssText='position:fixed;right:14px;top:14px;width:270px;background:white;color:#211c15;border:1px solid #e0e6ef;border-radius:4px;box-shadow:0 8px 28px #13274626;z-index:2147483640;font:12px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
  const header=document.createElement('div');header.textContent='操作提示';header.style.cssText='padding:8px 12px;background:#3478f6;color:white;cursor:pointer;display:flex;align-items:center;justify-content:space-between';box.append(header);
  const toggle=document.createElement('button');toggle.textContent=collapsed?'⌄':'⌃';toggle.title=collapsed?'展开操作提示':'收起操作提示';toggle.setAttribute('aria-expanded',String(!collapsed));toggle.style.cssText='border:0;background:none;color:white;cursor:pointer;font:inherit';header.append(toggle);
  const body=document.createElement('div');body.style.padding='12px';body.hidden=collapsed;box.append(body);header.onclick=()=>{body.hidden=!body.hidden;box.dataset.collapsed=String(body.hidden);toggle.textContent=body.hidden?'⌄':'⌃';toggle.title=body.hidden?'展开操作提示':'收起操作提示';toggle.setAttribute('aria-expanded',String(!body.hidden));};
  const note=text=>{const p=document.createElement('p');p.textContent=text;p.style.margin='0 0 12px';body.append(p);};
  const button=(label,action,primary=false)=>{const b=document.createElement('button');b.textContent=label;b.dataset.guideAction=action;b.style.cssText='display:block;width:100%;padding:7px 9px;margin:6px 0;text-align:left;cursor:pointer;border:1px solid '+(primary?'#3478f6':'#e4e9f1')+';border-radius:3px;background:'+(primary?'#3478f6':'white')+';color:'+(primary?'white':'#3478f6')+';font:inherit';b.onclick=()=>window.__v6?.send('guide',{action});body.append(b);return b;};
  if(state.phase==='progress'){
    note('正在识别网页数据');note(state.message||'正在滚动页面…');button('取消识别','stop-detect');
  }else if(state.phase==='idle'){
    note(state.message||'点击网页内容进行采集配置，或自动识别网页中的列表。');button('自动识别网页内容','detect',true);button('手动选择网页内容','manual');
  }else if(state.phase==='review'){
    note(`已识别到列表数据：${state.count} 条 · ${state.fields} 个字段`);
    note('查看网页框选及下方数据预览，确认后生成采集设置。');
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!state.more;check.onchange=()=>window.__v6?.send('guide',{action:'toggle-more'});label.append(check,document.createTextNode(' 加载更多按钮'));body.append(label);
    button('修改加载更多按钮','modify-more');
    button('生成采集设置','generate',true);button('取消','cancel');
    button(`切换识别结果 (${state.index+1}/${state.total})`,'next').disabled=state.total<2;
    button('没有要采集的数据？手动选择','manual');
  }else if(state.phase==='pick'){
    note(state.message);button('取消选择','cancel-pick');
  }else{
    note('已生成采集设置');note('您可以点击网页，配置采集，或：');
    const link=(label,action,path,half=false)=>{
      const b=button(label,action);b.style.cssText='display:inline-flex;align-items:center;gap:7px;width:'+(half?'50%':'100%')+';padding:6px 0;margin:0 0 7px;border:0;background:transparent;color:#3478f6;text-align:left;cursor:pointer;font:inherit';
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.style.cssText='width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round';const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',path);svg.append(shape);b.prepend(svg);
    };
    note('设置翻页，采集多页');link('翻页按钮','pagination','M14 4H4v14h7M14 10l5 5-5 5M9 15h10',true);link('加载更多按钮','more','M4 13V4h16v9M12 12v9M8 17l4 4 4-4',true);link('滚动加载','scroll','M7 3v18M3 17l4 4 4-4M15 4h6M15 10h6M15 16h6');
    note('采集下一级页面');link('选择页面地址','detail','M9 15l6-6M7 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M17 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0');link('保存并开始采集','run','M8 4v16l12-8-12-8');link('重新识别网页内容','detect','M20 7a8 8 0 1 0 1 8M20 2v5h-5');
  }
  for(const type of ['mousedown','click'])box.addEventListener(type,e=>e.stopPropagation());
  document.documentElement.append(box);
  v6DragTip(box,header);
  return {ok:true,visible:true,phase:state.phase};
}

// 识别前遍历主页面和内部滚动区，让懒加载内容进入 DOM。
async function v6PrepareDetect(options = {}) {
  window.__v6detectStopped = false;
  const maxMs = Math.min(120000, Math.max(1000, Number(options.maxMs) || 40000));
  const waitMs = Math.min(3000, Math.max(100, Number(options.waitMs) || 500));
  const started = Date.now(), known = new Set();
  const sleep = async ms => {
    const end = Date.now() + ms;
    while (!window.__v6detectStopped && Date.now() < end) await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
  };
  let stable = 0, signature = '', rounds = 0;
  try {
    while (!window.__v6detectStopped && Date.now() - started < maxMs) {
      const main = document.scrollingElement;
      const regions = main ? [main] : [];
      for (const el of document.querySelectorAll('body *')) {
        if (el === main || el.id?.startsWith('__v6') || !el.clientWidth || el.clientHeight < 80) continue;
        const style = getComputedStyle(el);
        if ((/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2) || (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2)) regions.push(el);
      }
      let moved = false;
      for (const el of regions) {
        if (!known.has(el)) { known.add(el); el.scrollTo({top:0,left:0,behavior:'instant'}); }
        const top = el.scrollTop, left = el.scrollLeft;
        el.scrollTo({top:Math.min(el.scrollHeight, top + Math.max(100, el.clientHeight * .85)),left:Math.min(el.scrollWidth, left + Math.max(100, el.clientWidth * .85)),behavior:'instant'});
        moved ||= Math.abs(el.scrollTop-top)>1 || Math.abs(el.scrollLeft-left)>1;
      }
      await sleep(waitMs);
      const next = regions.map(el=>`${el.scrollHeight}:${el.scrollWidth}:${el.childElementCount}`).join('|') + ':' + document.body.innerText.length;
      const atEnd = regions.every(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 3 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 3);
      stable = !moved && atEnd && next === signature ? stable+1 : 0;
      signature = next; rounds++;
      window.__v6?.send('detect-progress', {rounds, regions:regions.length, seconds:Math.round((Date.now()-started)/1000)});
      if (stable >= 3) break;
    }
    return { cancelled:!!window.__v6detectStopped, limited:stable<3 && !window.__v6detectStopped, rounds, regions:known.size };
  } finally {
    for (const el of known) if(el.isConnected) el.scrollTo({top:0,left:0,behavior:'instant'});
    if(!window.__v6detectStopped) await sleep(waitMs);
  }
}

function v6Captcha(action,params={}) {
  const id='__v6-captcha';
  if(action==='status'){
    const done=window.__v6captchaDone===true;
    if(!done&&!document.getElementById(id))v6Captcha('show',params);
    return {done};
  }
  document.getElementById(id)?.remove();
  if(action==='hide'){delete window.__v6captchaDone;return {ok:true};}
  window.__v6captchaDone=false;
  if(params.selector)document.querySelector(params.selector)?.scrollIntoView({block:'center'});
  const box=document.createElement('div');box.id=id;box.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483647;background:white;border:1px solid #dbe2ea;padding:14px;font:13px sans-serif;box-shadow:0 4px 18px #0002;color:#211c15';
  box.className='v6-controls';const style=document.createElement('style');style.textContent=v6ControlCss;box.append(style);
  const title=document.createElement('p');title.textContent='请手动完成'+({image:'图片验证码',slider:'滑块拼图',text:'点选文字'}[params.kind]||'验证码');
  const done=document.createElement('button');done.textContent='已完成，继续采集';done.onclick=()=>{window.__v6captchaDone=true;box.remove();};
  box.append(title,done);document.documentElement.append(box);return {ok:true};
}
// Repair old generated fields only when the saved column still resolves to an
// actual selection/expand control. Never delete a business field by name alone.
function v6RepairTableControls(cfg){
  const removed=[];
  const clean=(fields,list)=>{
    if(!list?.genericGrid||!list.tableRoot||!fields)return fields;
    let root;try{root=document.evaluate(list.tableRoot,document,null,9,null).singleNodeValue;}catch{return fields;}
    const table=root?.closest('.vxe-table');if(!table)return fields;
    return fields.filter(f=>{
      if(f.tableHeader!==''||!/^字段\d+$/.test(f.name)||!f.tableColumn?.startsWith('colid:'))return true;
      const id=f.tableColumn.slice(6),heads=[...table.querySelectorAll('th[colid]')].filter(h=>h.getAttribute('colid')===id&&h.closest('.vxe-table')===table);
      if(!heads.length||!heads.every(h=>h.matches('.col--checkbox,.col--radio,.col--expand')))return true;
      removed.push(f.name);return false;
    });
  };
  cfg.fields=clean(cfg.fields,cfg.list);
  const walk=(nodes,list)=>{for(const node of nodes||[]){const scope=node.params?.list||list;if(node.type==='extract'&&node.params?.fields)node.params.fields=clean(node.params.fields,scope);walk(node.children,scope);}};
  walk(cfg.flow,cfg.list);
  return {cfg,removed:[...new Set(removed)]};
}
module.exports = {
  repairTableControlsCode:()=>v6RepairTableControls.toString(),
  captchaCode:()=>build([v6Captcha],'v6Captcha'),
  revealListCode:()=>build([v6ResolveItems,function v6RevealList(list){const first=v6ResolveItems(list)[0];if(first)first.scrollIntoView({block:'center',behavior:'instant'});return {found:!!first};}],'v6RevealList'),
  detailSelectorCode:()=>build([v6StableClass,v6CssPath,v6ResolveItems,v6DetailSelector],'v6DetailSelector'),
  guideCode:()=>build([v6DragTip,v6Guide],'v6Guide'),
  prepareDetectCode: () => build([v6PrepareDetect], 'v6PrepareDetect'),
  previewCode: () => build([v6FieldNodes, v6ResolveItems, v6ExtractRow, v6Preview], 'v6Preview'),
  flowActionCode: () => build([v6FieldNodes, v6ResolveItems, v6ExtractRow, v6FlowAction], 'v6FlowAction'),
  loopUrlsCode: () => build([v6FieldNodes, v6ResolveItems, v6ExtractRow, v6LoopUrls], 'v6LoopUrls'),
  detectCode: () => build([v6StableClass, v6CssPath, v6FieldNodes, v6SmartName, v6ResolveItems, v6ExtractRow, v6SchemaInference, v6AlignFields, v6ScoreGroup, v6Detect], 'v6Detect'),
  highlightCode: () => build([v6StableClass, v6CssPath, v6FieldNodes, v6SmartName, v6ResolveItems, v6ExtractRow, v6Highlight], 'v6Highlight'),
  pickCode: () => build([v6DragTip, v6StableClass, v6CssPath, v6FieldNodes, v6ResolveItems, v6PickMode], 'v6PickMode'),
  resolvePickCode: () => build([v6StableClass, v6StableList, v6CssPath, v6FieldNodes, v6SmartName, v6ResolveItems, v6ExtractRow, v6SchemaInference, v6AlignFields, v6ResolvePick], 'v6ResolvePick'),
  listFingerprintCode:()=>build([v6ResolveItems,function v6ListFingerprint(cfg){return {url:location.href,items:v6ResolveItems(cfg.list).slice(0,5).map(el=>JSON.stringify([cfg.list?.virtualGrid?el.getAttribute('rowid'):'',(el.innerText||'').trim().slice(0,180),el.getAttribute('href')||el.querySelector('a[href]')?.getAttribute('href')||'']))};}],'v6ListFingerprint'),
  suggestListCode:()=>build([v6StableClass,v6StableList,v6ResolveItems,v6ExtractRow,function v6SuggestList(cfg){
    const selector=cfg.list?.selector||'';
    const classes=[...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m=>m[1]).reverse();
    for(const cls of classes){const el=document.querySelector('.'+CSS.escape(cls));if(!el)continue;const list=v6StableList(el);if(!list||list.selector===selector)continue;const items=v6ResolveItems(list);return {list,count:items.length,samples:items.slice(0,3).map(it=>v6ExtractRow(it,cfg.fields||[]))};}
    return {list:null,count:0,samples:[]};
  }],'v6SuggestList'),
  countCode: () => build([v6StableClass, v6CssPath, v6FieldNodes, v6SmartName, v6ResolveItems, v6ExtractRow, v6CountItems], 'v6CountItems'),
  scrollCollectCode: () => build([collectVirtualTable,v6StableClass, v6CssPath, v6FieldNodes, v6SmartName, v6ResolveItems, v6ExtractRow, v6ScrollCollect], 'v6ScrollCollect'),
  clickNextCode: () => build([v6ClickNext], 'v6ClickNext'),
  opTipCode: () => build([v6DragTip,v6OpTip], 'v6OpTip'),
};



