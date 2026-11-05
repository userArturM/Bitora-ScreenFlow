$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Runtime.Serialization.dll /out:assets/update-helper.exe native/UpdateHelper.cs
if ($LASTEXITCODE -ne 0) { throw 'Update helper compilation failed' }
