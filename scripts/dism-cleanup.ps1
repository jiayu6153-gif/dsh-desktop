# WinSxS 组件清理（需管理员权限，由用户点击 UAC 确认后执行）
$log = Join-Path $env:TEMP 'dism-cleanup.log'
"=== DISM 开始 $(Get-Date) ===" | Out-File $log -Encoding utf8
Dism /Online /Cleanup-Image /StartComponentCleanup 2>&1 | Tee-Object -FilePath $log -Append
"=== DISM 结束 $(Get-Date) exit=$LASTEXITCODE ===" | Out-File $log -Append
