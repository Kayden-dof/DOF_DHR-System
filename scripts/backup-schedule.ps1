# =============================================================================
#  정기 백업을 실제로 걸고, 걸렸는지 확인한다 (4차 감사 C4)
#
#  사내문서/백업과 복구.md 에 Register-ScheduledTask 명령이 적혀 있었다.
#  그런데 어떤 스크립트도 착수 절차도 그것을 부르지 않았고, 이 PC 에 그
#  작업이 없었다. **실기록을 넣기 시작하는 날 자동으로 도는 것이 하나도
#  없었다.**
#
#  문서에 적어 두는 것과 걸어 두는 것은 다르다. 그래서 실행하는 물건으로
#  옮긴다. 착수 절차가 이것을 부른다.
#
#  쓰는 법
#    확인   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-schedule.ps1
#    등록   ... -File scripts/backup-schedule.ps1 -Register
#    해제   ... -File scripts/backup-schedule.ps1 -Unregister
#
#  관리자 권한이 필요 없다. 로그인한 사용자의 작업으로 걸린다.
# =============================================================================

param(
  [switch]$Register,
  [switch]$Unregister,
  [string]$Time = "18:00",
  [int]$KeepDays = 90
)

$ErrorActionPreference = "Stop"
$TaskName = "DOF DHR 백업"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Job = Join-Path $Root "scripts\backup-job.ps1"

function Show-State {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-Host ""
    Write-Host "  정기 백업이 등록되어 있지 않습니다." -ForegroundColor Yellow
    Write-Host "  지금 자동으로 도는 것이 하나도 없습니다. 사람이 잊으면 백업이 없습니다."
    Write-Host ""
    Write-Host "  걸려면:"
    Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-schedule.ps1 -Register"
    return $false
  }

  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ""
  Write-Host "  정기 백업이 걸려 있습니다." -ForegroundColor Green
  Write-Host ("    상태        {0}" -f $t.State)
  Write-Host ("    마지막 실행  {0}" -f $i.LastRunTime)
  Write-Host ("    마지막 결과  {0}" -f $i.LastTaskResult)
  Write-Host ("    다음 실행    {0}" -f $i.NextRunTime)
  if ($i.LastTaskResult -ne 0 -and $i.LastRunTime -gt (Get-Date "1900-01-01")) {
    Write-Host "    마지막 실행이 0 이 아닙니다. backups\backup.log 를 보십시오." -ForegroundColor Yellow
  }
  return $true
}

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "  해제했습니다."
  exit 0
}

if (-not $Register) {
  $ok = Show-State
  if ($ok) { exit 0 } else { exit 1 }
}

if (-not (Test-Path $Job)) {
  Write-Host "  backup-job.ps1 을 찾지 못했습니다: $Job" -ForegroundColor Red
  exit 2
}

$arg = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -KeepDays {1}' -f $Job, $KeepDays
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $Root

# 평일 저녁. 3인 현장에서 하루 배치가 한둘이므로 그날 작업이 끝난 뒤 (백업과 복구.md)
$trg = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $Time

# PC 가 꺼져 있었으면 다음에 켤 때 한 번 돈다. 없으면 그날 백업이 통째로 없다
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Settings $set `
  -Description "운영 DB 백업 후 복구 가능 여부 확인 (사내문서/백업과 복구.md)" -Force | Out-Null

Write-Host "  등록했습니다. 확인합니다."

# 등록했다고 말하고 끝내지 않는다. 실제로 걸렸는지 다시 조회한다
if (Show-State) { exit 0 } else { exit 1 }
