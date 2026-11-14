$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskInput=Join-Path $taskRoot 'dist\win-unpacked'
$taskVersion=(Get-Content (Join-Path $taskRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$taskBuild=Join-Path $taskRoot "artifacts\build-v$taskVersion"
New-Item -ItemType Directory -Path $taskBuild -Force | Out-Null
$taskStub=Join-Path $taskBuild 'launcher.exe'
$taskZip=Join-Path $taskBuild 'payload.zip'
$taskOutput=Join-Path $taskRoot "dist\Codex-CLI-Plus-$taskVersion.exe"
if(Test-Path -LiteralPath $taskOutput){throw "Output already exists: $taskOutput"}
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ "/out:$taskStub" "/win32icon:$taskRoot\assets\icon.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll "$taskRoot\build\PortableLauncher.cs"
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
if(Test-Path -LiteralPath $taskZip){throw "Payload already exists: $taskZip"}
[IO.Compression.ZipFile]::CreateFromDirectory($taskInput,$taskZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$taskDest=[IO.File]::Create($taskOutput)
try {
  foreach($taskPart in @($taskStub,$taskZip)) {
    $taskSource=[IO.File]::OpenRead($taskPart)
    try {$taskSource.CopyTo($taskDest)} finally {$taskSource.Dispose()}
  }
  $taskFooter=[BitConverter]::GetBytes([long](Get-Item -LiteralPath $taskZip).Length)+[Text.Encoding]::ASCII.GetBytes('CCPLUS01')
  $taskDest.Write($taskFooter,0,$taskFooter.Length)
} finally {$taskDest.Dispose()}
Write-Output "Built $taskOutput"
