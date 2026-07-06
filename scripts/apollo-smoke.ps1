
# Objectif :
#   1. Vérifier que la clé fonctionne
#   2. Lister les champs réels retournés par /mixed_people/api_search
#   3. Enrich 1 prospect via /people/match et compter les crédits consommés
#   4. Estimer le coût pour ~30 prospects/mois

if (-not $env:APOLLO_API_KEY) {
    Write-Host "ERREUR : variable d environnement APOLLO_API_KEY non definie." -ForegroundColor Red
    Write-Host 'Lance d abord :  $env:APOLLO_API_KEY = "ta_cle_apollo"'
    exit 1
}

$base = "https://api.apollo.io/api/v1"
$headers = @{
    "X-Api-Key"    = $env:APOLLO_API_KEY
    "Content-Type" = "application/json"
    "Cache-Control" = "no-cache"
}

# ETAPE 1 : Search (gratuit)
Write-Host "`n=== 1. SEARCH /mixed_people/api_search ===" -ForegroundColor Cyan

$searchBody = @{
    per_page = 3
    page = 1
    person_locations = @("Paris, France")
    organization_num_employees_ranges = @("11,50")
    person_seniorities = @("owner", "founder", "c_suite", "partner", "director")
    contact_email_status = @("verified", "likely to engage")
} | ConvertTo-Json -Depth 5

Write-Host "Body envoye :" -ForegroundColor DarkGray
Write-Host $searchBody -ForegroundColor DarkGray

try {
    $searchResp = Invoke-WebRequest -Uri "$base/mixed_people/api_search" `
        -Method POST -Headers $headers -Body $searchBody -UseBasicParsing
} catch {
    Write-Host "`nERREUR HTTP :" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
    exit 1
}

Write-Host "`nStatus : $($searchResp.StatusCode)" -ForegroundColor Green
Write-Host "`n--- Headers credits Apollo ---" -ForegroundColor Yellow
$searchResp.Headers.GetEnumerator() | Where-Object { $_.Key -match "credit|rate|limit" } | ForEach-Object {
    Write-Host ("  {0} = {1}" -f $_.Key, ($_.Value -join ", "))
}

$searchData = $searchResp.Content | ConvertFrom-Json
$people = if ($searchData.people) { $searchData.people } elseif ($searchData.contacts) { $searchData.contacts } else { @() }

Write-Host "`nTotal entries : $($searchData.pagination.total_entries)" -ForegroundColor Green
Write-Host "Prospects recus : $($people.Count)" -ForegroundColor Green

if ($people.Count -eq 0) {
    Write-Host "Aucun prospect retourne — arret du test." -ForegroundColor Red
    exit 1
}

Write-Host "`n--- Champs disponibles sur people[0] ---" -ForegroundColor Yellow
$people[0].PSObject.Properties | ForEach-Object {
    $val = $_.Value
    if ($null -eq $val) { $disp = "null" }
    elseif ($val -is [string]) { $disp = if ($val.Length -gt 60) { $val.Substring(0,60) + "..." } else { $val } }
    elseif ($val -is [array]) { $disp = "[array x$($val.Count)]" }
    elseif ($val.PSObject.Properties) { $disp = "[object]" }
    else { $disp = "$val" }
    Write-Host ("  {0,-32} {1}" -f $_.Name, $disp)
}

Write-Host "`n--- Champs disponibles sur people[0].organization ---" -ForegroundColor Yellow
if ($people[0].organization) {
    $people[0].organization.PSObject.Properties | ForEach-Object {
        $val = $_.Value
        if ($null -eq $val) { $disp = "null" }
        elseif ($val -is [string]) { $disp = if ($val.Length -gt 60) { $val.Substring(0,60) + "..." } else { $val } }
        elseif ($val -is [array]) { $disp = "[array x$($val.Count)]" }
        elseif ($val.PSObject.Properties) { $disp = "[object]" }
        else { $disp = "$val" }
        Write-Host ("  {0,-32} {1}" -f $_.Name, $disp)
    }
} else {
    Write-Host "  (pas d objet organization)" -ForegroundColor DarkGray
}

Write-Host "`n--- Resume des 3 prospects ---" -ForegroundColor Yellow
$i = 0
foreach ($p in $people) {
    $i++
    $name = ($p.first_name, $p.last_name | Where-Object { $_ }) -join " "
    $org = if ($p.organization) { $p.organization.name } else { $p.organization_name }
    $hasEmail = if ($p.email) { "OUI ($($p.email))" } else { "non" }
    Write-Host ("  [{0}] {1,-30} | {2,-30} | {3,-20} | email: {4}" -f $i, $name, $org, $p.title, $hasEmail)
    Write-Host ("       id={0}" -f $p.id) -ForegroundColor DarkGray
}

# ETAPE 2 : Enrich (credits)
Write-Host "`n=== 2. ENRICH /people/match (1 prospect) ===" -ForegroundColor Cyan

$target = $people | Where-Object { -not $_.email } | Select-Object -First 1
if (-not $target) { $target = $people[0] }

Write-Host "Target : $($target.first_name) $($target.last_name) — id=$($target.id)"

$enrichBody = @{
    id = $target.id
    reveal_personal_emails = $false
} | ConvertTo-Json

try {
    $enrichResp = Invoke-WebRequest -Uri "$base/people/match" `
        -Method POST -Headers $headers -Body $enrichBody -UseBasicParsing
} catch {
    Write-Host "`nERREUR enrich :" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
    exit 1
}

Write-Host "`nStatus : $($enrichResp.StatusCode)" -ForegroundColor Green
Write-Host "`n--- Headers credits Apollo (enrich) ---" -ForegroundColor Yellow
$enrichResp.Headers.GetEnumerator() | Where-Object { $_.Key -match "credit|rate|limit" } | ForEach-Object {
    Write-Host ("  {0} = {1}" -f $_.Key, ($_.Value -join ", "))
}

$enrichData = $enrichResp.Content | ConvertFrom-Json
$person = $enrichData.person

if ($person) {
    Write-Host "`n--- Resultat enrich ---" -ForegroundColor Yellow
    Write-Host ("  Email          : {0}" -f $person.email)
    Write-Host ("  Email status   : {0}" -f $person.email_status)
    Write-Host ("  Phone numbers  : {0}" -f ($person.phone_numbers | ConvertTo-Json -Compress))
    Write-Host ("  LinkedIn       : {0}" -f $person.linkedin_url)

    Write-Host "`n--- TOUS les champs de la fiche enrichie ---" -ForegroundColor Yellow
    $person.PSObject.Properties | ForEach-Object {
        $val = $_.Value
        if ($null -eq $val) { $disp = "null" }
        elseif ($val -is [string]) { $disp = if ($val.Length -gt 80) { $val.Substring(0,80) + "..." } else { $val } }
        elseif ($val -is [array]) { $disp = "[array x$($val.Count)]" }
        elseif ($val.PSObject.Properties) { $disp = "[object]" }
        else { $disp = "$val" }
        Write-Host ("  {0,-32} {1}" -f $_.Name, $disp)
    }
} else {
    Write-Host "Aucune fiche retournee — reponse brute :" -ForegroundColor Red
    Write-Host ($enrichData | ConvertTo-Json -Depth 5)
}

# ETAPE 3 : Estimation cout
Write-Host "`n=== 3. ESTIMATION COUT ===" -ForegroundColor Cyan
Write-Host "Compare les headers x-*-credit-* avant/apres pour deduire le cout par enrich."
Write-Host "Pour ~30 prospects/mois : ~30 enrichs/mois si search dedupe correctement."
Write-Host "`nDONE." -ForegroundColor Green
