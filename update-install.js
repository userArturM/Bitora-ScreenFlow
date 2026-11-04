const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
function installScript(file,expected,portableTarget,{parentPid=process.pid,installedTarget=process.execPath,restart=true,statusFile=path.join(path.dirname(file),'install-result.json')}={}){
 const target=portableTarget||installedTarget;
 return [
  `$ErrorActionPreference = 'Stop'`,
  `$source = ${quote(file)}`,`$target = ${quote(target)}`,`$report = ${quote(statusFile)}`,`$swapped = $false`,`$health = $null`,
  `$backup = $target + '.previous.exe'`,`$stage = $target + '.next.exe'`,
  `function Report($status, $message) { @{status=$status; message=$message; time=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $report -Encoding UTF8 }`,
  `Write-Output 'Helper started'`,
  `try {`,
  `  Write-Output 'Waiting for application exit'`,
  `  Wait-Process -Id ${Number(parentPid)} -Timeout 60 -ErrorAction SilentlyContinue`,
  `  if (Get-Process -Id ${Number(parentPid)} -ErrorAction SilentlyContinue) { throw 'Application did not exit; update cancelled' }`,
  `  Write-Output 'Verifying checksum'`,
  `  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower() -ne ${quote(expected)}) { throw 'SHA-256 mismatch; no files replaced' }`,
  ...(portableTarget?[
   `  Copy-Item -LiteralPath $source -Destination $stage -Force`,
   `  if ((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash.ToLower() -ne ${quote(expected)}) { throw 'Staged file checksum mismatch' }`,
   `  $done = $false`,
   `  for ($i=0; $i -lt 60; $i++) {`,
   `    try { [System.IO.File]::Replace($stage, $target, $backup, $true); $swapped=$true; $done=$true; break } catch { Start-Sleep -Seconds 1 }`,
   `  }`,
   `  if (-not $done) { throw 'Could not replace portable executable; original preserved' }`
  ]:[
   `  $arguments = '/S /D=' + (Split-Path -Parent $target)`,
   `  Write-Output 'Starting installer'`,
   `  $installer = Start-Process -FilePath $source -ArgumentList $arguments -PassThru`,
   `  if (-not $installer.WaitForExit(120000)) { throw 'Installer did not exit within 120 seconds; check installer window' }`,
   `  Write-Output ('Installer exited: ' + $installer.ExitCode)`,
   `  if ($installer.ExitCode -ne 0) { throw ('Installer exit code: ' + $installer.ExitCode) }`
  ]),
  `  Write-Output 'Checking updated application'`,
  `  $health = Start-Process -FilePath $target -ArgumentList '--update-health' -PassThru`,
  `  if (-not $health.WaitForExit(60000)) { $health.Kill(); throw 'Updated app startup timed out' }`,
  `  if ($health.ExitCode -ne 0) { throw ('Updated app startup failed: ' + $health.ExitCode) }`,
  `  Report 'success' 'Update installed and startup verified'`,
  ...(restart?[`  Start-Process -FilePath $target`]:[]),
  `} catch {`,
  `  $message = $_.Exception.Message`,
  ...(portableTarget?[
   `  if ($swapped) {`,
   `    try {`,
   `      if ($health -and -not $health.HasExited) { $health.Kill(); $health.WaitForExit() }`,
   `      $restored=$false`,
   `      for ($i=0; $i -lt 60; $i++) { try { [System.IO.File]::Replace($backup,$target,$null,$true); $restored=$true; break } catch { Start-Sleep -Seconds 1 } }`,
   `      if (-not $restored) { throw 'Rollback failed; previous EXE remains at backup path' }`,
   `      Report 'rolled-back' $message`,
   ...(restart?[`      Start-Process -FilePath $target`]:[]),
   `    } catch { Report 'error' ($message + '; ' + $_.Exception.Message) }`,
   `  } else { Report 'error' $message }`
  ]:[`  Report 'error' $message`]),
  `  exit 1`,
  `} finally { Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue }`,
  `exit 0`
 ].join('\r\n');
}
async function launchUpdate(file,expected,portableTarget,options){
 if(process.platform!=='win32')throw new Error('Установка обновлений поддерживается в Windows');
 const directory=path.dirname(file),script=path.join(directory,'install-update.ps1');
 const marker=path.join(directory,'helper-started.txt');await fs.rm(marker,{force:true});
 const code=`Set-Content -LiteralPath ${quote(marker)} -Value 'ready' -Encoding ASCII\r\n`+installScript(file,expected,portableTarget,options);
 await fs.writeFile(script,'\ufeff'+code,'utf8');
 const log=await fs.open(path.join(directory,'install-helper.log'),'a');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{stdio:['ignore',log.fd,log.fd],windowsHide:true});
 let failed;child.once('error',e=>{failed=e;});child.once('exit',code=>{failed=new Error('Помощник обновления завершился до запуска: '+code);});
 try{
   const deadline=Date.now()+15000;
   while(!await fs.access(marker).then(()=>true,()=>false)){
     if(failed)throw failed;
     if(Date.now()>deadline){child.kill();throw new Error('Помощник обновления не запустился. Программа остаётся открытой; проверьте install-helper.log.');}
     await new Promise(r=>setTimeout(r,100));
   }
   child.unref();
 }finally{await log.close();}
}
module.exports={launchUpdate,installScript};
