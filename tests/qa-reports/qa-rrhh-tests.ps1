# ==============================================================
# PowerShell QA - Backend App Movil RRHH (Cloud Run)
# Usuario: rrhh.qa@demo.com | Rol: RRHH
# ==============================================================

$BASE_URL = "https://backend-app-movil-177686674468.europe-west1.run.app"
$EMAIL = "rrhh.qa@demo.com"
$PASS = "RrhhDemo2026!"

function Test-Endpoint {
  param(
    $Label,
    $Method,
    $Uri,
    $Headers = @{},
    $Body = $null
  )

  Write-Host "`n[$Label]" -ForegroundColor Cyan

  try {
    $params = @{
      Uri = $Uri
      Method = $Method
      UseBasicParsing = $true
      Headers = $Headers
    }

    if ($Body) {
      $params.Body = $Body
      $params.ContentType = "application/json"
    }

    $r = Invoke-WebRequest @params
    Write-Host "  HTTP $($r.StatusCode)" -ForegroundColor Green
    Write-Host "  $($r.Content)" -ForegroundColor Gray
    return $r
  }
  catch {
    $code = $_.Exception.Response.StatusCode.value__
    $msg = $_.ErrorDetails.Message
    $color = if ($code -in 401,403,404) { "Yellow" } else { "Red" }
    Write-Host "  HTTP $code - $msg" -ForegroundColor $color
    return $null
  }
}

Write-Host "`n[1/12 GET /]" -ForegroundColor Cyan
Test-Endpoint "1/12 GET /" GET "$BASE_URL/"

Write-Host "`n[2/12 GET /health]" -ForegroundColor Cyan
Test-Endpoint "2/12 GET /health" GET "$BASE_URL/health"

Write-Host "`n[3/12 GET /health/db]" -ForegroundColor Cyan
Test-Endpoint "3/12 GET /health/db" GET "$BASE_URL/health/db"

Write-Host "`n[4/12 GET /routes]" -ForegroundColor Cyan
Test-Endpoint "4/12 GET /routes" GET "$BASE_URL/routes"

Write-Host "`n[5/12 POST /api/login - RRHH]" -ForegroundColor Cyan
$loginBody = (@{ email = $EMAIL; password = $PASS } | ConvertTo-Json)

try {
  $r = Invoke-WebRequest -Uri "$BASE_URL/api/login" -Method POST -ContentType "application/json" -Body $loginBody -UseBasicParsing
  $json = $r.Content | ConvertFrom-Json

  if ($json.success -and $json.data.accessToken) {
    $global:TOKEN = $json.data.accessToken
    $global:REFRESH = $json.data.refreshToken
    $shortTok = $global:TOKEN.Substring(0,30) + "..."
    Write-Host "  HTTP $($r.StatusCode) - LOGIN EXITOSO" -ForegroundColor Green
    Write-Host "  accessToken: $shortTok" -ForegroundColor Gray
    Write-Host "  role: $($json.data.user.role)" -ForegroundColor Gray
  }
  else {
    Write-Host "  HTTP $($r.StatusCode) - success=false" -ForegroundColor Yellow
    Write-Host "  $($r.Content)" -ForegroundColor Gray
  }
}
catch {
  $code = $_.Exception.Response.StatusCode.value__
  Write-Host "  HTTP $code - $($_.ErrorDetails.Message)" -ForegroundColor Red
  Write-Host "  Ejecuta create-rrhh-qa-user.sql en Supabase primero." -ForegroundColor Yellow
}

if ($global:TOKEN) {
  $auth = @{ Authorization = "Bearer $global:TOKEN" }

  Write-Host "`n[6/12 GET /auth/2fa/generate]" -ForegroundColor Cyan
  Test-Endpoint "6/12 GET /auth/2fa/generate" GET "$BASE_URL/auth/2fa/generate" $auth

  Write-Host "`n[7/12 GET /users]" -ForegroundColor Cyan
  Test-Endpoint "7/12 GET /users" GET "$BASE_URL/users" $auth

  Write-Host "`n[8/12 GET /workers]" -ForegroundColor Cyan
  Test-Endpoint "8/12 GET /workers" GET "$BASE_URL/workers" $auth

  Write-Host "`n[9/12 GET /attendance/today]" -ForegroundColor Cyan
  Test-Endpoint "9/12 GET /attendance/today" GET "$BASE_URL/attendance/today" $auth

  Write-Host "`n[10/12 GET /devices/my]" -ForegroundColor Cyan
  Test-Endpoint "10/12 GET /devices/my" GET "$BASE_URL/devices/my" $auth

  Write-Host "`n[11/12 GET /dashboard/summary]" -ForegroundColor Cyan
  Test-Endpoint "11/12 GET /dashboard/summary" GET "$BASE_URL/dashboard/summary" $auth

  Write-Host "`n[12/12 GET /reports/attendance]" -ForegroundColor Cyan
  Test-Endpoint "12/12 GET /reports/attendance" GET "$BASE_URL/reports/attendance" $auth

  Write-Host "`n[BONUS POST /auth/refresh-token]" -ForegroundColor Cyan
  $refreshBody = (@{ token = $global:REFRESH } | ConvertTo-Json)
  Test-Endpoint "BONUS refresh-token" POST "$BASE_URL/auth/refresh-token" @{} $refreshBody
}
else {
  Write-Host "`nSin token - Omitiendo pruebas de rutas protegidas." -ForegroundColor Yellow
}

Write-Host "`nQA completado." -ForegroundColor Magenta
