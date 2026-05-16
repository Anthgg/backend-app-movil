# ==============================================================
# PowerShell QA - Solicitudes + Documentos (Cloud Run)
# ==============================================================

$BASE_URL = "https://backend-app-movil-177686674468.europe-west1.run.app"
$EMAIL    = "admin.qa@demo.com"
$PASS     = "AdminDemo2026!"

$totalTests = 0
$passedTests = 0
$failedTests = 0

function Test-EP {
  param($Label, $Method, $Uri, $Headers = @{}, $Body = $null, $ContentType = "application/json", $ExpectCode = 200)
  $script:totalTests++
  Write-Host "`n[$Label]" -ForegroundColor Cyan
  try {
    $p = @{ Uri = $Uri; Method = $Method; UseBasicParsing = $true; Headers = $Headers }
    if ($Body -and $ContentType -eq "application/json") {
      $p.Body = $Body
      $p.ContentType = "application/json"
    }
    $r = Invoke-WebRequest @p
    $ok = if ($r.StatusCode -eq $ExpectCode) { "PASS" } else { "WARN" }
    if ($r.StatusCode -eq $ExpectCode) { $script:passedTests++ } else { $script:failedTests++ }
    Write-Host "  $ok HTTP $($r.StatusCode) (esperado: $ExpectCode)" -ForegroundColor $(if ($r.StatusCode -eq $ExpectCode) { "Green" } else { "Yellow" })
    $content = $r.Content | ConvertFrom-Json
    $preview = ($content | ConvertTo-Json -Compress -Depth 3)
    if ($preview.Length -gt 200) { $preview = $preview.Substring(0, 200) + "..." }
    Write-Host "  $preview" -ForegroundColor Gray
    return $content
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $errMsg = $_.ErrorDetails.Message
    if ($code -eq $ExpectCode) {
      $script:passedTests++
      Write-Host "  PASS HTTP $code (esperado: $ExpectCode)" -ForegroundColor Green
      try { return ($errMsg | ConvertFrom-Json) } catch { return $null }
    } else {
      $script:failedTests++
      Write-Host "  FAIL HTTP $code (esperado: $ExpectCode) - $errMsg" -ForegroundColor Red
      return $null
    }
  }
}

Write-Host "=============================================" -ForegroundColor Magenta
Write-Host " QA - SOLICITUDES + DOCUMENTOS ADJUNTOS" -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta

# -- 1. LOGIN -----------------------------------------------
Write-Host "`n[1. LOGIN]" -ForegroundColor Cyan
$loginBody = (@{ email = $EMAIL; password = $PASS } | ConvertTo-Json)
$script:totalTests++
try {
  $r = Invoke-WebRequest -Uri "$BASE_URL/api/login" -Method POST -ContentType "application/json" -Body $loginBody -UseBasicParsing
  $json = $r.Content | ConvertFrom-Json
  if ($json.success -and $json.data.accessToken) {
    $global:TOKEN = $json.data.accessToken
    $tok = $global:TOKEN.Substring(0,25) + "..."
    Write-Host "  PASS Login OK | role: $($json.data.user.role) | token: $tok" -ForegroundColor Green
    $script:passedTests++
  }
} catch {
  Write-Host "  FAIL Login fallido - $($_.ErrorDetails.Message)" -ForegroundColor Red
  $script:failedTests++
  Write-Host "`nSin token. Abortando tests." -ForegroundColor Yellow
  exit 1
}

$auth = @{ Authorization = "Bearer $global:TOKEN" }

# -- 2. TIPOS DE SOLICITUD ---------------------------------
$typesRes = Test-EP "2. GET /api/requests/types" GET "$BASE_URL/api/requests/types" $auth
$requestTypeId = ""
if ($typesRes -and $typesRes.data.requestTypes.Count -gt 0) {
  $requestTypeId = $typesRes.data.requestTypes[0].id
  Write-Host "  Tipo seleccionado: $($typesRes.data.requestTypes[0].name) ($requestTypeId)" -ForegroundColor DarkCyan
}

Test-EP "2b. GET /api/request-types (alias)" GET "$BASE_URL/api/request-types" $auth

# -- 3. CREAR SOLICITUD (JSON) -----------------------------
# Usar fechas dinamicas para evitar conflictos con ejecuciones anteriores
$randomDays = Get-Random -Minimum 200 -Maximum 500
$startDate = (Get-Date).AddDays($randomDays).ToString("yyyy-MM-dd")
$endDate = (Get-Date).AddDays($randomDays + 1).ToString("yyyy-MM-dd")
Write-Host "`n  Usando fechas: $startDate a $endDate" -ForegroundColor DarkGray

$createBody = (@{
  requestTypeId = $requestTypeId
  startDate = $startDate
  endDate = $endDate
  reason = "QA Test - Solicitud con documentos"
} | ConvertTo-Json)

$createRes = Test-EP "3. POST /api/requests (crear)" POST "$BASE_URL/api/requests" $auth $createBody "application/json" 201
$testRequestId = ""
if ($createRes -and $createRes.success) {
  $testRequestId = $createRes.data.request.id
  Write-Host "  Solicitud creada: $testRequestId | status: $($createRes.data.request.status)" -ForegroundColor DarkCyan

  if ($null -ne $createRes.data.documents) {
    Write-Host "  Response incluye campo 'documents' (array)" -ForegroundColor Green
  } else {
    Write-Host "  Response no incluye campo 'documents'" -ForegroundColor Yellow
  }
}

# -- 4. MIS SOLICITUDES ------------------------------------
$myUrl = "$BASE_URL/api/requests/my?page=1" + "&" + "limit=5"
Test-EP "4. GET /api/requests/my" GET $myUrl $auth

$myPendingUrl = "$BASE_URL/api/requests/my?status=pending"
Test-EP "4b. GET /api/requests/my (pending)" GET $myPendingUrl $auth

# -- 5. TODAS LAS SOLICITUDES (ADMIN) ----------------------
$allUrl = "$BASE_URL/api/requests?page=1" + "&" + "limit=5"
Test-EP "5. GET /api/requests (todas)" GET $allUrl $auth
Test-EP "5b. GET /api/requests/pending" GET "$BASE_URL/api/requests/pending" $auth

# -- 6. DETALLE DE SOLICITUD -------------------------------
if ($testRequestId) {
  $detailRes = Test-EP "6. GET /api/requests/:id" GET "$BASE_URL/api/requests/$testRequestId" $auth
  if ($detailRes -and $detailRes.data.request) {
    $hasDocField = $null -ne $detailRes.data.request.documents
    Write-Host "  Campo 'documents' en detalle: $hasDocField" -ForegroundColor DarkCyan
    if ($hasDocField) {
      Write-Host "  Documentos adjuntos: $($detailRes.data.request.documents.Count)" -ForegroundColor DarkCyan
    }
  }
}

# -- 7. SUBIR DOCUMENTOS -----------------------------------
$uploadedDocId = ""
if ($testRequestId) {
  Write-Host "`n[7. POST /api/requests/:id/documents (upload)]" -ForegroundColor Cyan
  $script:totalTests++

  $tempFile = [System.IO.Path]::GetTempFileName()
  $tempFile = $tempFile + ".txt"
  "Este es un archivo de prueba para QA - Solicitudes" | Out-File -FilePath $tempFile -Encoding utf8

  try {
    $boundary = [System.Guid]::NewGuid().ToString()
    $fileBytes = [System.IO.File]::ReadAllBytes($tempFile)
    $fileContent = [System.Text.Encoding]::GetEncoding("iso-8859-1").GetString($fileBytes)
    
    $LF = "`r`n"
    $bodyStr = "--$boundary$LF"
    $bodyStr += "Content-Disposition: form-data; name=`"documents`"; filename=`"test-qa-document.txt`"$LF"
    $bodyStr += "Content-Type: text/plain$LF$LF"
    $bodyStr += "$fileContent$LF"
    $bodyStr += "--$boundary--$LF"

    $uploadRes = Invoke-WebRequest `
      -Uri "$BASE_URL/api/requests/$testRequestId/documents" `
      -Method POST `
      -Headers $auth `
      -ContentType "multipart/form-data; boundary=$boundary" `
      -Body ([System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes($bodyStr)) `
      -UseBasicParsing

    $uploadJson = $uploadRes.Content | ConvertFrom-Json
    if ($uploadJson.success) {
      $script:passedTests++
      Write-Host "  PASS HTTP $($uploadRes.StatusCode) - $($uploadJson.message)" -ForegroundColor Green
      if ($uploadJson.data.documents.Count -gt 0) {
        $uploadedDocId = $uploadJson.data.documents[0].id
        Write-Host "  Doc ID: $uploadedDocId" -ForegroundColor DarkCyan
        Write-Host "  URL: $($uploadJson.data.documents[0].file_url)" -ForegroundColor DarkCyan
        Write-Host "  MIME: $($uploadJson.data.documents[0].mime_type)" -ForegroundColor DarkCyan
        Write-Host "  Size: $($uploadJson.data.documents[0].file_size) bytes" -ForegroundColor DarkCyan
      }
    } else {
      $script:failedTests++
      Write-Host "  FAIL Upload fallo - $($uploadJson.message)" -ForegroundColor Red
    }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $errMsg = $_.ErrorDetails.Message
    $script:failedTests++
    Write-Host "  FAIL HTTP $code - $errMsg" -ForegroundColor Red
    Write-Host "  NOTA: Puede ser normal si el bucket 'request-documents' no esta creado en Supabase Storage." -ForegroundColor Yellow
  } finally {
    Remove-Item $tempFile -ErrorAction SilentlyContinue
  }
}

# -- 8. LISTAR DOCUMENTOS ----------------------------------
if ($testRequestId) {
  $docsRes = Test-EP "8. GET /api/requests/:id/documents" GET "$BASE_URL/api/requests/$testRequestId/documents" $auth
  if ($docsRes -and $docsRes.data.documents) {
    Write-Host "  Total documentos: $($docsRes.data.documents.Count)" -ForegroundColor DarkCyan
  }
}

# -- 9. ELIMINAR DOCUMENTO ---------------------------------
if ($testRequestId -and $uploadedDocId) {
  Test-EP "9. DELETE /api/requests/:id/documents/:docId" DELETE "$BASE_URL/api/requests/$testRequestId/documents/$uploadedDocId" $auth
}

# -- 10. UPLOAD SIN ARCHIVOS (debe fallar 400) -------------
if ($testRequestId) {
  Test-EP "10. POST documents SIN archivos (400)" POST "$BASE_URL/api/requests/$testRequestId/documents" $auth $null "application/json" 400
}

# -- 11. REVIEW: OBSERVAR ----------------------------------
if ($testRequestId) {
  $observeBody = (@{ action = "observe"; reason = "Adjuntar certificado medico" } | ConvertTo-Json)
  Test-EP "11. POST /review (observar)" POST "$BASE_URL/api/requests/$testRequestId/review" $auth $observeBody "application/json"
}

# -- 12. RESUBMIT ------------------------------------------
if ($testRequestId) {
  $resubmitBody = (@{ reason = "Motivo corregido - QA resubmit" } | ConvertTo-Json)
  Test-EP "12. PATCH /resubmit" PATCH "$BASE_URL/api/requests/$testRequestId/resubmit" $auth $resubmitBody "application/json"
}

# -- 13. REVIEW: APROBAR -----------------------------------
if ($testRequestId) {
  $approveBody = (@{ action = "approve"; reason = "Aprobado en QA" } | ConvertTo-Json)
  Test-EP "13. POST /review (aprobar)" POST "$BASE_URL/api/requests/$testRequestId/review" $auth $approveBody "application/json"
}

# -- 14. CANCELAR APROBADA (debe fallar) -------------------
if ($testRequestId) {
  Test-EP "14. POST /cancel (falla, ya aprobada)" POST "$BASE_URL/api/requests/$testRequestId/cancel" $auth $null "application/json" 422
}

# -- 15. REVIEW CON ACTION INVALIDA ------------------------
if ($testRequestId) {
  $invalidBody = (@{ action = "invalid"; reason = "test" } | ConvertTo-Json)
  Test-EP "15. POST /review (action invalida)" POST "$BASE_URL/api/requests/$testRequestId/review" $auth $invalidBody "application/json" 400
}

# -- 16. SIN TOKEN (401) -----------------------------------
Test-EP "16. GET /requests SIN token (401)" GET "$BASE_URL/api/requests" @{} $null "application/json" 401

# -- 17. SOLICITUD INEXISTENTE (404) -----------------------
Test-EP "17. GET /requests/:id falso (404)" GET "$BASE_URL/api/requests/00000000-0000-0000-0000-000000000000" $auth $null "application/json" 404

# -- RESUMEN -----------------------------------------------
Write-Host "`n=============================================" -ForegroundColor Magenta
Write-Host " RESUMEN QA - SOLICITUDES + DOCUMENTOS" -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "  Total:   $totalTests tests" -ForegroundColor White
Write-Host "  Passed:  $passedTests" -ForegroundColor Green
Write-Host "  Failed:  $failedTests" -ForegroundColor $(if ($failedTests -eq 0) { "Green" } else { "Red" })
$pct = if ($totalTests -gt 0) { [math]::Round(($passedTests / $totalTests) * 100) } else { 0 }
Write-Host "  Rate:    $pct%" -ForegroundColor $(if ($pct -ge 90) { "Green" } elseif ($pct -ge 70) { "Yellow" } else { "Red" })
Write-Host "" -ForegroundColor Magenta
