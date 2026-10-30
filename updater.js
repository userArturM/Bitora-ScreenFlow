const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const ROOT='https://github.com/userArturM/Bitora-ScreenFlow';
function newer(a,b){const parse=s=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);const x=parse(a),y=parse(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function assetURL(value){const u=new URL(value);if(!value.startsWith(ROOT+'/releases/download/')||u.protocol!=='https:'||u.username||u.password)throw new Error('Недопустимый адрес обновления');return value;}
function checksum(text,name){const rows=text.split(/\r?\n/).map(l=>/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(l)).filter(m=>m&&m[2]===name);if(rows.length!==1)throw new Error('SHA-256 для файла не найден или неоднозначен');return rows[0][1].toLowerCase();}
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))hash.update(chunk);return hash.digest('hex');}
class Updater{
  constructor({fetch,current,directory,portable=false}){Object.assign(this,{fetch,current,directory,portable});this.state={phase:'idle'};this.release=null;this.ready=null;}
  async check(){
    if(['checking','downloading','ready','queued','installing'].includes(this.state.phase))return this.state;
    this.state={...this.state,phase:'checking'};
    try {
    const r=await this.fetch('https://api.github.com/repos/userArturM/Bitora-ScreenFlow/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(r.status===404?'Релиз недоступен. Для закрытого репозитория используйте GitHub в браузере.':'GitHub: '+r.status);
    const d=await r.json();this.release=null;this.ready=null;
    const kind=this.portable?'Portable':'Setup';
    const name=`Bitora-ScreenFlow-${kind}-${String(d.tag_name).replace(/^v/,'')}-x64.exe`;
    const asset=d.assets?.find(a=>a.name===name),sum=d.assets?.find(a=>a.name==='SHA256SUMS.txt');
    const available=!d.draft&&!d.prerelease&&newer(d.tag_name,this.current)&&!!asset&&!!sum;
    if(available)this.release={name,url:assetURL(asset.browser_download_url),sum:assetURL(sum.browser_download_url),size:asset.size};
    return this.state={phase:available?'available':'current',current:this.current,version:d.tag_name,notes:String(d.body||'').slice(0,20000),available};
    }catch(e){this.state={...this.state,phase:'error',error:e.message};throw e;}
  }
  async download(){
    if(!this.release||this.state.phase!=='available')throw new Error('Сначала проверьте обновления');
    const release=this.release;this.state={...this.state,phase:'downloading',received:0};
    const file=path.join(this.directory,release.name),tmp=file+'.part';
    try{
      await fs.mkdir(this.directory,{recursive:true});
      const sums=await this.fetch(release.sum,{signal:AbortSignal.timeout(30000)});if(!sums.ok)throw new Error('Не удалось скачать SHA256SUMS.txt');
      const expected=checksum(await sums.text(),release.name);
      const r=await this.fetch(release.url,{signal:AbortSignal.timeout(30*60*1000)});if(!r.ok||!r.body)throw new Error('Не удалось скачать обновление');
      const handle=await fs.open(tmp,'w');
      try{for await(const chunk of r.body){await handle.writeFile(chunk);this.state.received+=chunk.length;if(this.state.received>release.size)throw new Error('Неверный размер обновления');}}finally{await handle.close();}
      if(this.state.received!==release.size||await hashFile(tmp)!==expected)throw new Error('Проверка SHA-256 не пройдена. Установка отменена.');
      await fs.rename(tmp,file);this.ready={file,expected};this.state={...this.state,phase:'ready'};return this.state;
    }catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});this.state={...this.state,phase:'available',error:e.message};throw e;}
  }
  async verify(){if(!this.ready||await hashFile(this.ready.file)!==this.ready.expected)throw new Error('Файл обновления изменён. Скачайте его заново.');return this.ready.file;}
}
module.exports={Updater,newer,checksum,assetURL,hashFile};
