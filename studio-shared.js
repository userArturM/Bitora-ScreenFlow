(function(root){
function safeShotName(name){if(typeof name!=='string'||!name||/[\\/:\x00]/.test(name)||!name.toLowerCase().endsWith('.png')||name==='..')throw new Error('Неверное имя скриншота');return name;}
function trimRange(start,end,duration){if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(duration)||start<0||end<=start||end>duration+0.05)throw new Error('Укажите начало и конец в пределах длительности видео.');return {start,end:Math.min(end,duration)};}
function cropRect(r,w,h){if(!r)return {x:0,y:0,width:w,height:h};const x=Math.max(0,Math.min(w-2,Math.round(r.x))),y=Math.max(0,Math.min(h-2,Math.round(r.y)));return {x,y,width:Math.max(2,Math.min(w-x,Math.round(r.width))),height:Math.max(2,Math.min(h-y,Math.round(r.height)))};}
const api={safeShotName,trimRange,cropRect};if(typeof module==='object')module.exports=api;else root.StudioShared=api;
})(typeof window==='object'?window:globalThis);
