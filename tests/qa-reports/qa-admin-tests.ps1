# ==============================================================
# PowerShell QA — Backend ADMIN (Cloud Run)
# ==============================================================

$BASE_URL = "https://backend-app-movil-177686674468.europe-west1.run.app"
$EMAIL    = "admin.qa@demo.com"
$PASS     = "AdminDemo2026!"

function Test-EP {
  param($Label, $Method, $Uri, $Headers = @{}, $Body = $null, $ExpectCode = 200)
  Write-Host "`n[$Label]" -ForegroundColor Cyan
  try {
    $p = @{ Uri = $Uri; Method = $Method; UseBasicParsing = $true; Headers = $Headers }
    if ($Body) { $p.Body = $Body; $p.ContentType = "application/json" }
    $r = Invoke-WebRequest @p
    $ok = if ($r.StatusCode -eq $ExpectCode) { "✅" } else { "⚠️ " }
    Write-Host "  $ok HTTP $($r.StatusCode) (esperado: $ExpectCode)" -ForegroundColor $(if ($r.StatusCode -eq $ExpectCode) { "Green" } else { "Yellow" })
    Write-Host "  $(($r.Content | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 2).Substring(0, [Math]::Min(120, ($r.Content).Length)))" -ForegroundColor Gray
    return $r
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "  ❌ HTTP $code — $($_.ErrorDetails.Message)" -ForegroundColor Red
    return $null
  }
}

# ── 1. Públicas ────────────────────────────────────────────
Test-EP "1/12 GET /"          GET "$BASE_URL/"
Test-EP "2/12 GET /health"    GET "$BASE_URL/health"
Test-EP "3/12 GET /health/db" GET "$BASE_URL/health/db"
Test-EP "4/12 GET /routes"    GET "$BASE_URL/routes"

# ── 2. Login ───────────────────────────────────────────────
Write-Host "`n[5/12 POST /api/login — ADMIN]" -ForegroundColor Cyan
$loginBody = (@{ email = $EMAIL; password = $PASS } | ConvertTo-Json)
try {
  $r    = Invoke-WebRequest -Uri "$BASE_URL/api/login" -Method POST -ContentType "application/json" -Body $loginBody -UseBasicParsing
  $json = $r.Content | ConvertFrom-Json
  if ($json.success -and $json.data.accessToken) {
    $global:TOKEN   = $json.data.accessToken
    $global:REFRESH = $json.data.refreshToken
    $tok = $global:TOKEN.Substring(0,25) + "..."
    Write-Host "  ✅ HTTP $($r.StatusCode) — Login OK | role: $($json.data.user.role) | token: $tok" -ForegroundColor Green
  }
} catch {
  Write-Host "  ❌ HTTP $($_.Exception.Response.StatusCode.value__) — $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# ── 3. Protegidas ──────────────────────────────────────────
if ($global:TOKEN) {
  $auth = @{ Authorization = "Bearer $global:TOKEN" }
  Test-EP "6/12  GET /auth/me"              GET  "$BASE_URL/auth/me"              $auth
  Test-EP "7/12  GET /users"                GET  "$BASE_URL/users"                $auth
  Test-EP "8/12  GET /workers"              GET  "$BASE_URL/workers"              $auth
  Test-EP "9/12  GET /attendance/today"     GET  "$BASE_URL/attendance/today"     $auth
  Test-EP "10/12 GET /attendance/my-records"GET  "$BASE_URL/attendance/my-records"$auth
  Test-EP "11/12 GET /devices/my"           GET  "$BASE_URL/devices/my"           $auth
  Test-EP "12/12 GET /dashboard/summary"    GET  "$BASE_URL/dashboard/summary"    $auth
  Test-EP "EXTRA GET /reports/attendance"   GET  "$BASE_URL/reports/attendance"   $auth
  Test-EP "EXTRA GET /payroll/periods"      GET  "$BASE_URL/payroll/periods"      $auth
  Test-EP "EXTRA GET /payroll (alias)"      GET  "$BASE_URL/payroll"              $auth

  # Refresh token
  $rbody = (@{ token = $global:REFRESH } | ConvertTo-Json)
  Test-EP "BONUS POST /auth/refresh-token"  POST "$BASE_URL/auth/refresh-token" @{} $rbody
} else {
  Write-Host "`n⚠️  Sin token — login falló. Verifica credenciales." -ForegroundColor Yellow
}

Write-Host "`n✅ QA ADMIN completado.`n" -ForegroundColor Magenta