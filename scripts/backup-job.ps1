# ---------------------------------------------------------------------------
#  정기 백업 실행기
#
#  작업 스케줄러가 부르는 자리다. 사람이 손으로 돌릴 때는
#  npm run backup 이면 된다.
#
#  하는 일 세 가지
#    1. 운영 DB 를 뜬다
#    2. 방금 뜬 것이 실제로 되살아나는지 확인한다
#    3. 오래된 백업을 정리한다 (기본 90일)
#
#  2번이 핵심이다. 되살아나는지 확인하지 않은 백업은 백업이 아니라 파일이다.
#  실제로 첫 운영 훈련에서 표 16개가 불일치로 나왔는데, 확인하지 않았다면
#  필요할 때까지 몰랐을 일이다 (원인은 시각대였고 지금은 고쳐져 있다).
#
#  결과는 backups/backup.log 에 쌓인다. 실패하면 종료 코드가 0 이 아니므로
#  작업 스케줄러 기록에도 남는다.
# ---------------------------------------------------------------------------
param(
  [int]$KeepDays = 90,
  [switch]$SkipCheck
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root 'backups'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'backup.log'

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

Write-Log '--- 백업 시작 ---'

try {
  $out = & node --env-file=.env.deploy scripts/backup.mjs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "백업 실패 (종료 코드 $LASTEXITCODE)" }
  $out | Where-Object { $_ -match '자료|목록' } | ForEach-Object { Write-Log $_.Trim() }

  if (-not $SkipCheck) {
    $chk = & node scripts/restore-check.mjs 2>&1
    if ($LASTEXITCODE -ne 0) {
      $chk | ForEach-Object { Write-Log $_ }
      throw '복구 확인 실패. 위 내용을 보고 원인을 찾을 것.'
    }
    $chk | Where-Object { $_ -match '복구 확인 완료|되살리는 데' } |
      ForEach-Object { Write-Log $_.Trim() }
  }

  # 오래된 것 정리. 보관 기간은 사내문서/백업과 복구.md 에서 정한 값을 쓴다.
  $cut = (Get-Date).AddDays(-$KeepDays)
  $old = Get-ChildItem $logDir -Filter 'dhr-*' | Where-Object { $_.LastWriteTime -lt $cut }
  if ($old) {
    $old | Remove-Item -Force
    Write-Log ("보관 기간({0}일)이 지난 백업 {1}개를 지웠습니다" -f $KeepDays, $old.Count)
  }

  Write-Log '--- 백업 완료 ---'
  exit 0
}
catch {
  Write-Log ("실패: {0}" -f $_.Exception.Message)
  Write-Log '--- 백업 중단 ---'
  exit 1
}
