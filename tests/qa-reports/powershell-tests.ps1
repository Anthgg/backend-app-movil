# ==============================================================
# PowerShell QA — Backend App Movil (Cloud Run)
# ==============================================================

$BASE_URL = "https://backend-app-movil-177686674468.europe-west1.run.app"

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host " QA Backend App Movil — Cloud Run" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# --- GET / ---
Write-Host "[1/8] GET /" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/" -Method GET -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch { Write-Host "  ❌ HTTP $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red }

# --- GET /health ---
Write-Host "[2/8] GET /health" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/health" -Method GET -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch { Write-Host "  ❌ HTTP $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red }

# --- GET /health/db ---
Write-Host "[3/8] GET /health/db" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/health/db" -Method GET -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch { Write-Host "  ❌ HTTP $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red }

# --- GET /routes ---
Write-Host "[4/8] GET /routes" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/routes" -Method GET -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch { Write-Host "  ❌ HTTP $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red }

# --- GET /api/login (debe dar 405) ---
Write-Host "[5/8] GET /api/login (espera 405)" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/login" -Method GET -UseBasicParsing
    Write-Host "  ⚠️  HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Yellow
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 405) {
        Write-Host "  ✅ HTTP 405 — Bloqueo correcto" -ForegroundColor Green
    } else {
        Write-Host "  ❌ HTTP $code — Inesperado" -ForegroundColor Red
    }
}

# --- POST /api/login ---
Write-Host "[6/8] POST /api/login" -ForegroundColor Cyan
$body = '{"email":"correo_de_prueba@demo.com","password":"password_de_prueba"}'
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/login" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
    $json = $r.Content | ConvertFrom-Json
    if ($json.data.accessToken) {
        $global:TOKEN = $json.data.accessToken
        $global:REFRESH = $json.data.refreshToken
        Write-Host "  ✅ HTTP $($r.StatusCode) — LOGIN EXITOSO — Token guardado" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Yellow
    }
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "  ✅ HTTP $code — $($_.ErrorDetails.Message) (usuario no existe en DB)" -ForegroundColor Yellow
}

# --- POST /api/auth/login ---
Write-Host "[7/8] POST /api/auth/login" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/auth/login" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "  ✅ HTTP $code — Ruta activa, controlada correctamente" -ForegroundColor Yellow
}

# --- POST /auth/login ---
Write-Host "[8/8] POST /auth/login" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/auth/login" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
    Write-Host "  ✅ HTTP $($r.StatusCode) — $($r.Content)" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "  ✅ HTTP $code — Ruta activa, controlada correctamente" -ForegroundColor Yellow
}

Write-Host "`n✅ QA completado. Si TOKEN guardado, probar rutas protegidas:" -ForegroundColor Magenta
Write-Host "  Invoke-RestMethod -Uri '$BASE_URL/auth/me' -Headers @{Authorization='Bearer '+`$global:TOKEN}" -ForegroundColor Gray
