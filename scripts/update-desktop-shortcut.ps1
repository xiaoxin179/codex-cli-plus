$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskProjectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$taskExecutable = Join-Path $taskProjectRoot "dist\Codex-CLI-Plus-$taskVersion.exe"
if (-not (Test-Path -LiteralPath $taskExecutable -PathType Leaf)) { throw "Build not found: $taskExecutable" }
$taskShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex CLI Plus.lnk'
$taskShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = $taskExecutable
$taskShortcut.WorkingDirectory = $taskProjectRoot
$taskShortcut.IconLocation = Join-Path $taskProjectRoot 'assets\icon.ico'
$taskShortcut.Save()
# Only archive older portable EXEs after the shortcut points at the new build.
$taskDist = (Resolve-Path -LiteralPath (Join-Path $taskProjectRoot 'dist')).Path
$taskArchive = Join-Path $taskProjectRoot ('artifacts\old-installers-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
foreach ($taskOld in Get-ChildItem -LiteralPath $taskDist -File -Filter 'Codex-CLI-Plus-*.exe') {
  if ($taskOld.FullName -eq $taskExecutable) { continue }
  if ($taskOld.DirectoryName -ne $taskDist) { throw 'Unexpected installer path' }
  New-Item -ItemType Directory -Path $taskArchive -Force | Out-Null
  Move-Item -LiteralPath $taskOld.FullName -Destination $taskArchive
}
Write-Output "Desktop shortcut updated to $taskVersion."
