const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
function installScript(file,expected,portableTarget,{parentPid=process.pid,installedTarget=process.execPath,restart=true,statusFile=path.join(path.dirname(file),'install-result.json')}={}){
 const target=portableTarget||installedTarget;
 return [
  `$ErrorActionPreference = 'Stop'`,
  `$source = ${quote(file)}`,`$target = ${quote(target)}`,`$report = ${quote(statusFile)}`,`$swapped = $false`,`$health = $null`,
  `$backup = $target + '.previous.exe'`,`$stage = $target + '.next.exe'`,
  `function Report($status, $message) { @{status=$status; message=$message; time=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $report -Encoding UTF8 }`,
  `try {`,
  `  Wait-Process -Id ${Number(parentPid)} -ErrorAction SilentlyContinue`,
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
   `  $installer = Start-Process -FilePath $source -ArgumentList $arguments -PassThru -Wait`,
   `  if ($installer.ExitCode -ne 0) { throw ('Installer exit code: ' + $installer.ExitCode) }`
  ]),
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
 const script=path.join(path.dirname(file),'install-update.ps1');
 await fs.writeFile(script,'\ufeff'+installScript(file,expected,portableTarget,options),'utf8');
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{detached:true,stdio:'ignore',windowsHide:true});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
module.exports={launchUpdate,installScript};
