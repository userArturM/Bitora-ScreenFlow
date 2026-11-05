$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = (Resolve-Path 'native/UpdateHelper.cs').Path
$output = Join-Path $pwd 'assets/update-helper.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Runtime.Serialization.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Update helper compilation failed' }
