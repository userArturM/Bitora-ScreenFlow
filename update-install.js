const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
async function launchUpdate(file,expected,portableTarget){
  if(process.platform!=='win32')throw new Error('Установка обновлений поддерживается в Windows');
  const script=path.join(path.dirname(file),'install-update.ps1');
  const lines=[`$ErrorActionPreference = 'Stop'`,`Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,`$source = ${quote(file)}`,`if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower() -ne ${quote(expected)}) { throw 'SHA-256 mismatch' }`];
  if(portableTarget){
    lines.push(`$target = ${quote(portableTarget)}`,`$backup = $target + '.previous'`,`$done = $false`,`for ($i=0; $i -lt 60; $i++) {`,`  try { Copy-Item -LiteralPath $target -Destination $backup -Force; Copy-Item -LiteralPath $source -Destination $target -Force; $done = $true; break } catch { Start-Sleep -Seconds 1 }`,`}`,`if (-not $done) { throw 'Could not replace portable executable' }`,`Start-Process -FilePath $target`);
  }else lines.push(`Start-Process -FilePath $source`);
  await fs.writeFile(script,'\ufeff'+lines.join('\r\n'),'utf8');
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
module.exports={launchUpdate};
