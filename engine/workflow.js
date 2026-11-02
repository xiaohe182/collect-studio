(function (root) {
  const labels = { open: '打开网页', pages: '循环翻页', list: '循环列表', detail: '进入详情并返回', extract: '提取数据', next: '点击翻页', wait: '等待', click: '点击元素', hover: '移动到元素上', input: '输入文本', scroll: '滚动页面' };
  let sequence = 0;
  Object.assign(labels,{inputGroup:'组合输入文本',captcha:'人工处理验证码'});
  Object.assign(labels,{repeat:'循环',scrollLoop:'循环滚动网页',loadMore:'循环加载更多',back:'返回上一级网页',select:'切换下拉选项',condition:'判断条件'});
  function node(type) {
    const result = { id: 'n' + Date.now().toString(36) + (++sequence), type, name: labels[type], enabled: true, params: {} };
    if (['pages','list','repeat','scrollLoop','loadMore','condition'].includes(type)) result.children = [];
    if(type==='scrollLoop')result.params={count:100,seconds:1,bottom:true,stopUnchanged:true};
    if(type==='loadMore')result.params={count:100,seconds:1,stopUnchanged:true};
    if (type === 'detail') { result.params = { relative: true }; result.children = [node('extract')]; }
    return result;
  }
  function defaults(names = {}) {
    const open = node('open'), pages = node('pages'), list = node('list'), extract = node('extract'), next = node('next');
    for (const item of [open, pages, list, extract, next]) item.name = names[item.type] || item.name;
    list.children.push(extract); pages.children.push(list, next);
    return [open, pages];
  }
  function find(nodes, id) {
    for (let index = 0; index < nodes.length; index++) {
      if (nodes[index].id === id) return { node: nodes[index], siblings: nodes, index };
      const found = nodes[index].children && find(nodes[index].children, id);
      if (found) return found;
    }
    return null;
  }
  function copy(source) {
    const result = structuredClone(source);
    function renew(item) { item.id = node(item.type).id; item.children?.forEach(renew); }
    renew(result); return result;
  }
  // 移动前检查目标，避免将父节点拖进自身而丢失整组步骤。
  function move(nodes, id, targetId, inside = false) {
    const source = find(nodes, id), target = find(nodes, targetId);
    if (!source || !target || id === targetId || find(source.node.children || [], targetId)) return false;
    if (inside && !target.node.children) return false;
    source.siblings.splice(source.index, 1);
    if (inside) target.node.children.push(source.node);
    else {
      const destination = find(nodes, targetId);
      destination.siblings.splice(destination.index, 0, source.node);
    }
    return true;
  }
  function validate(nodes) {
    const ids = new Set(); let count = 0;
    function visit(items, depth) {
      if (!Array.isArray(items) || depth > 8) throw Error('流程层级不能超过 8 层');
      for (const item of items) {
        if (++count > 200 || !item || !labels[item.type] || !item.id || ids.has(item.id)) throw Error('流程节点类型、数量或编号无效');
        ids.add(item.id);
        const p = item.params || {};
        (typeof module!=='undefined'&&module.exports?require('./node-retry'):root.NodeRetry).validatePolicy(p,item.type);
        if(p.scrollMaxSec!==undefined&&(!Number.isFinite(Number(p.scrollMaxSec))||Number(p.scrollMaxSec)<0||Number(p.scrollMaxSec)>3600))throw Error('打开网页滚动时间须为 0 到 3600 秒');
        if(p.after?.enabled&&(!Number.isFinite(Number(p.after.seconds??1))||Number(p.after.seconds??1)<0))throw Error('执行后等待不能为负数');
        if(p.limitEnabled===true&&p.count===undefined)throw Error('请填写循环执行次数');
        if(p.before?.enabled){
          const b=p.before;
          if(b.mode==='fixed'&&(!Number.isFinite(Number(b.seconds??1))||Number(b.seconds??1)<0))throw Error('执行前等待不能为负数');
          if(b.waitElement&&(!b.xpath?.trim()||(b.inFrame&&!b.frameXPath?.trim())))throw Error('请填写等待元素及 iframe XPath');
          if(b.waitElement&&(!Number.isFinite(Number(b.timeout??25))||Number(b.timeout??25)<0))throw Error('等待元素超时不能为负数');
        }
        for (const key of ['seconds', 'count', 'pixels','timeout','retries']) {
          if (p[key] !== undefined && (!Number.isFinite(Number(p[key])) || Number(p[key]) < 0 || Number(p[key]) > (key === 'pixels' ? 100000 : key === 'count' ? 999 : key==='retries'?600:Infinity))) throw Error('节点数值超出范围');
        }
        if (p.count !== undefined && (!Number.isInteger(Number(p.count)) || Number(p.count) < 1)) throw Error('循环次数必须是正整数');
        if (item.children && !['pages','list','detail','repeat','scrollLoop','loadMore','condition'].includes(item.type)) throw Error('此节点不能包含子步骤');
        if (item.children) visit(item.children, depth + 1);
      }
    }
    visit(nodes, 0);
    if (!count) throw Error('请添加流程节点');
    return true;
  }
  function hasExtract(nodes) {return nodes.some(n=>n.enabled!==false&&(n.type==='extract'||n.children&&hasExtract(n.children)));}
  function matches(value,op,expected) {
    const text=String(value??''),other=String(expected??'');
    if(op==='empty')return !text.trim();
    if(op==='notEmpty')return !!text.trim();
    if(op==='contains')return text.includes(other);
    if(op==='notContains')return !text.includes(other);
    if(op==='gt')return Number.isFinite(Number(text))&&Number(text)>Number(other);
    if(op==='lt')return Number.isFinite(Number(text))&&Number(text)<Number(other);
    if(op==='ne')return text!==other;
    return text===other;
  }
  function filterRows(rows,fields,triggers=[]) {
    return rows.filter(row=>!triggers.some(trigger=>trigger.enabled!==false && trigger.groups?.some(group=>group.length&&group.every(rule=>{const index=fields.findIndex(f=>f.name===rule.field);return index>=0&&matches(row[index],rule.op,rule.value);} ))));
  }
  // 点选生成的旧规则未记录 mode；其路径是 CSS，不得默认当成 XPath。
  function selectorMode(params={}) { return params.mode || (/^\s*(\/|\.\/|\(|id\s*\()/.test(params.selector||'')?'xpath':'css'); }
  function resultFields(cfg) {
    const fields=[];
    function visit(nodes){for(const n of nodes||[]){if(n.enabled===false)continue;if(n.type==='extract')for(const f of n.params?.fields||cfg.fields||[]){if(f.__on!==false&&!fields.some(x=>x.name===f.name))fields.push(f);}visit(n.children);}}
    visit(cfg.flow);return fields.length?fields:cfg.fields||[];
  }
  const api = { labels, node, defaults, find, copy, move, validate,hasExtract,matches,filterRows,selectorMode,resultFields };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Workflow = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
