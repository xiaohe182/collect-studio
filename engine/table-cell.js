'use strict';
// Serialized with the page collector. Keep this function browser-only.
function readTableCell(cell,field={}) {
  if(!cell)return '';
  const absolute=value=>{if(!value)return '';try{return new URL(value,cell.ownerDocument.baseURI).href;}catch{return value;}};
  if(field.type==='html')return cell.outerHTML;
  if(field.type==='innerHtml')return cell.innerHTML;
  if(field.type==='value')return cell.querySelector('input,textarea,select')?.value||'';
  if(field.type==='href')return [...new Set(Array.from(cell.querySelectorAll('a[href]'),a=>a.href))].join('\n');
  const images=[...new Set(Array.from(cell.querySelectorAll('img'),img=>absolute(img.getAttribute('data-src')||img.getAttribute('data-original')||img.getAttribute('data-lazy-src')||img.currentSrc||img.getAttribute('src'))).filter(Boolean))];
  if(field.type==='img')return images.join('\n');
  const text=(cell.innerText||cell.textContent||'').replace(/\s+/g,' ').trim();
  // Existing table configurations used text for every column, including photos.
  return [text,...images].filter(Boolean).join('\n');
}
module.exports={readTableCell};
