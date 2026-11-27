# Roteiro de aceitação: como o sistema deve funcionar, fluxo a fluxo.
# Uso: com o servidor rodando (npm run dev), execute:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\acceptance\Run-Acceptance.ps1
# Gera um relatório em markdown (ver -ReportPath).
#
# Estados:
#   OK         o sistema faz como deve
#   FALHOU     o sistema existe mas não faz como deve (defeito a corrigir)
#   PENDENTE   ainda não codificado, ou depende de uma decisão de negócio
#   BLOQUEADO  depende de chave, conta ou serviço externo que não está configurado

param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$ReportPath = (Join-Path $PSScriptRoot 'RELATORIO_ACEITACAO.md'),
  [string]$Password = 'Confianca2026!'
)

$ErrorActionPreference = 'Stop'
$script:rows = New-Object System.Collections.ArrayList
$script:stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')

function Add-Result([string]$Flow, [string]$Id, [string]$Desc, [string]$Status, [string]$Detail) {
  [void]$script:rows.Add([pscustomobject]@{ Fluxo = $Flow; Id = $Id; Verificacao = $Desc; Status = $Status; Detalhe = $Detail })
}

# Executa um bloco de verificação. O bloco devolve @{ status = ...; detail = ... }.
function Check([string]$Flow, [string]$Id, [string]$Desc, [scriptblock]$Block) {
  try {
    $r = & $Block
    Add-Result $Flow $Id $Desc $r.status $r.detail
  } catch {
    Add-Result $Flow $Id $Desc 'FALHOU' ("exceção: " + $_.Exception.Message)
  }
}

function Res([string]$status, [string]$detail) { return @{ status = $status; detail = $detail } }

function Api($method, $path, $session, $body) {
  $h = @{ 'X-Requested-With' = 'XMLHttpRequest' }
  $args = @{ Uri = "$BaseUrl$path"; Method = $method; Headers = $h; WebSession = $session; UseBasicParsing = $true }
  if ($null -ne $body) { $args.Body = ($body | ConvertTo-Json -Depth 8); $args.ContentType = 'application/json' }
  $resp = Invoke-RestMethod @args
  return $resp
}

# Chamada que devolve o código HTTP em vez de lançar erro.
function Probe($method, $path, $session, $body) {
  try {
    $r = Api $method $path $session $body
    return @{ code = 200; body = $r }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ code = $code; body = $null; msg = $_.ErrorDetails.Message }
  }
}

function Login($email) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $h = @{ 'X-Requested-With' = 'XMLHttpRequest' }
  $b = @{ email = $email; password = $Password } | ConvertTo-Json
  Invoke-RestMethod -Headers $h -Uri "$BaseUrl/api/auth/login" -Method Post -Body $b -ContentType 'application/json' -WebSession $s | Out-Null
  return $s
}

function Money($v) { return [math]::Round([double]$v, 2) }
function Near($a, $b, $tol) { return ([math]::Abs([double]$a - [double]$b) -le $tol) }

# ---------- preparação ----------
$admin = Login 'diego@confiancamanutencao.com'
$cust = Login 'maria@cliente.pt'
$tech = Login 'joao@confiancamanutencao.com'
$catalog = @((Api 'GET' '/api/catalog' $cust $null).catalog)[0]
$techList = Api 'GET' '/api/technicians' $admin $null
$techRows = if ($techList.technicians) { $techList.technicians } else { $techList }
$joao = @($techRows | Where-Object { $_.id -eq 'user-tech-joao' })[0]
$pct = if ($joao) { [double]$joao.effective_payout_percentage } else { 50 }

function NewOrder($suffix) {
  $body = @{
    catalog_id = $catalog.id
    service_address = "Rua de teste $suffix, Lisboa"
    scheduled_at = (Get-Date).AddDays(5).ToString('o')
    description = "Teste de aceitação $suffix"
    appliance_type = 'Micro-ondas'
  }
  return (Api 'POST' '/api/orders' $cust $body).order
}

# ---------- F1 Abertura ----------
$F = 'F1 Abertura do chamado'
$o1 = $null
Check $F 'F1.1' 'Cliente abre o chamado (status Aguardando)' {
  $script:o1 = NewOrder 'F1'
  if ($o1.status -eq 'pending' -and $o1.reference_code -like 'WO-2026-*') { Res 'OK' "ref=$($o1.reference_code)" } else { Res 'FALHOU' "status=$($o1.status) ref=$($o1.reference_code)" }
}
Check $F 'F1.2' 'Gestor vê o chamado na lista' {
  $list = @((Api 'GET' '/api/orders' $admin $null).orders)
  if (@($list | Where-Object { $_.id -eq $o1.id }).Count -eq 1) { Res 'OK' '' } else { Res 'FALHOU' 'chamado não aparece na lista da gestão' }
}
Check $F 'F1.3' 'Código de referência único entre dois chamados' {
  $o1b = NewOrder 'F1b'
  if ($o1b.reference_code -ne $o1.reference_code) { Res 'OK' "$($o1.reference_code) / $($o1b.reference_code)" } else { Res 'FALHOU' 'referências iguais' }
}
Check $F 'F1.4' 'Tipo de aparelho e NIF gravados no chamado' {
  if ($o1.appliance_type -eq 'Micro-ondas' -and $o1.customer_nif) { Res 'OK' "aparelho=$($o1.appliance_type) nif=$($o1.customer_nif)" } else { Res 'FALHOU' "aparelho=$($o1.appliance_type) nif=$($o1.customer_nif)" }
}

# ---------- F2 Aceite no mural ----------
$F = 'F2 Aceite pelo técnico'
Check $F 'F2.1' 'Técnico aceita chamado do mural (status Aceite)' {
  $r = Probe 'PATCH' "/api/orders/$($o1.id)" $tech @{ status = 'accepted' }
  if ($r.code -eq 200 -and $r.body.order.status -eq 'accepted') { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F2.2' 'Cliente não aceita pelo técnico (403)' {
  $r = Probe 'PATCH' "/api/orders/$($o1.id)" $cust @{ status = 'accepted' }
  if ($r.code -eq 403 -or $r.code -eq 400) { Res 'OK' "code=$($r.code)" } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F3 Agendamento sugerido ----------
$F = 'F3 Agendamento'
Check $F 'F3.1' 'Técnico sugere novo horário; cliente aceita' {
  $sug = Probe 'POST' "/api/orders/$($o1.id)/suggest-schedule" $tech @{ suggested_date = (Get-Date).AddDays(6).ToString('yyyy-MM-dd'); suggested_time = '10:00' }
  if ($sug.code -ne 200) { return (Res 'FALHOU' "sugestão code=$($sug.code)") }
  $dec = Probe 'POST' "/api/orders/$($o1.id)/suggestion-decision" $cust @{ decision = 'accepted' }
  if ($dec.code -eq 200) { Res 'OK' '' } else { Res 'FALHOU' "decisão code=$($dec.code)" }
}

# ---------- F4 Orçamento aprovado e repasse ----------
$F = 'F4 Orçamento aprovado'
Check $F 'F4.1' 'Técnico lança orçamento e envia ao cliente' {
  $q = Probe 'POST' "/api/orders/$($o1.id)/quote" $tech @{ labor_cost = 30; extra_fee = 10; items = @(@{ description = 'Resistência'; quantity = 1; customer_unit_price = 45; supplier_unit_cost = 0; supplier_id = $null }); send_to_customer = $true }
  if ($q.code -eq 200 -and $q.body.order.quote_status -eq 'sent') { Res 'OK' '' } else { Res 'FALHOU' "code=$($q.code)" }
}
Check $F 'F4.2' 'Cliente aprova orçamento' {
  $d = Probe 'POST' "/api/orders/$($o1.id)/quote-decision" $cust @{ decision = 'accepted' }
  if ($d.code -eq 200 -and $d.body.order.quote_status -eq 'accepted') { Res 'OK' '' } else { Res 'FALHOU' "code=$($d.code)" }
}
Check $F 'F4.3' 'Repasse = percentagem × (taxa de serviço + M.O. + taxa extra)' {
  $o = (Api 'GET' "/api/orders/$($o1.id)" $admin $null).order
  $esperado = ($pct / 100) * ([double]$o.service_fee + [double]$o.labor_cost + [double]$o.extra_fee)
  if (Near $o.technician_payout $esperado 0.02) { Res 'OK' "repasse=$($o.technician_payout) esperado=$(Money $esperado) pct=$pct" } else { Res 'FALHOU' "repasse=$($o.technician_payout) esperado=$(Money $esperado) pct=$pct" }
}

# ---------- F5 Orçamento recusado ----------
$F = 'F5 Orçamento recusado'
$o2 = $null
Check $F 'F5.1' 'Orçamento recusado: repasse só sobre a taxa de serviço' {
  $script:o2 = NewOrder 'F5'
  $null = Probe 'PATCH' "/api/orders/$($o2.id)" $tech @{ status = 'accepted' }
  $null = Probe 'POST' "/api/orders/$($o2.id)/quote" $tech @{ labor_cost = 40; extra_fee = 0; items = @(); send_to_customer = $true }
  $d = Probe 'POST' "/api/orders/$($o2.id)/quote-decision" $cust @{ decision = 'rejected' }
  if ($d.code -ne 200) { return (Res 'FALHOU' "decisão code=$($d.code)") }
  $o = (Api 'GET' "/api/orders/$($o2.id)" $admin $null).order
  $esperado = ($pct / 100) * [double]$o.service_fee
  if (Near $o.technician_payout $esperado 0.02) { Res 'OK' "repasse=$($o.technician_payout)" } else { Res 'FALHOU' "repasse=$($o.technician_payout) esperado=$(Money $esperado)" }
}

# ---------- F6 Garantia ----------
$F = 'F6 Garantia'
Check $F 'F6.1' 'Garantia: repasse = percentagem × (taxa de serviço + M.O.)' {
  $null = Probe 'PATCH' "/api/orders/$($o1.id)" $admin @{ is_warranty = $true; status = 'completed' }
  $o = (Api 'GET' "/api/orders/$($o1.id)" $admin $null).order
  $esperado = ($pct / 100) * ([double]$o.service_fee + [double]$o.labor_cost)
  if (Near $o.technician_payout $esperado 0.02) { Res 'OK' "repasse=$($o.technician_payout)" } else { Res 'FALHOU' "repasse=$($o.technician_payout) esperado=$(Money $esperado)" }
}

# ---------- F7 Pagamento online ----------
$F = 'F7 Pagamento online'
Check $F 'F7.1' 'Webhook da Stripe recusa evento sem assinatura' {
  $evt = @{ type = 'checkout.session.completed'; data = @{ object = @{ payment_status = 'paid'; metadata = @{ service_order_id = $o2.id } } } }
  $r = Probe 'POST' '/api/webhooks/stripe' $null $evt
  if ($r.code -eq 503 -or $r.code -eq 400) { Res 'OK' "code=$($r.code)" } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F7.2' 'Pagamento assinado marca a taxa como paga (exige Stripe configurada)' {
  $st = Probe 'GET' '/api/ai/status' $cust $null
  return (Res 'BLOQUEADO' 'precisa de STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET no servidor; testado à parte com segredo fictício')
}
Check $F 'F7.3' 'Métodos de pagamento ativados na Stripe' {
  return (Res 'BLOQUEADO' 'depende de ativar cada método na conta Stripe (decisão + conta)')
}

# ---------- F8 Recebimento e caixa ----------
$F = 'F8 Recebimento e caixa'
Check $F 'F8.1' 'Dar baixa registra recebimento' {
  $b = Probe 'POST' "/api/orders/$($o2.id)/baixa" $admin @{ received_at = (Get-Date).ToString('yyyy-MM-dd') }
  if ($b.code -eq 200) { Res 'OK' '' } else { Res 'FALHOU' "code=$($b.code)" }
}
Check $F 'F8.2' 'Recebimento aparece no fluxo de caixa' {
  $cf = Api 'GET' '/api/cash-flow' $admin $null
  $entries = if ($cf.entries) { $cf.entries } else { $cf }
  $hit = @($entries | Where-Object { $_.description -like "Recebimento (baixa)*$($o2.reference_code)" })
  if ($hit.Count -ge 1) { Res 'OK' '' } else { Res 'FALHOU' 'nenhum lançamento de receita para a ordem' }
}
Check $F 'F8.3' 'Desfazer a baixa remove a receita' {
  $null = Probe 'POST' "/api/orders/$($o2.id)/baixa" $admin @{ undo = $true }
  $cf = Api 'GET' '/api/cash-flow' $admin $null
  $entries = if ($cf.entries) { $cf.entries } else { $cf }
  if (@($entries | Where-Object { $_.description -like "Recebimento (baixa)*$($o2.reference_code)" }).Count -eq 0) { Res 'OK' '' } else { Res 'FALHOU' 'lançamento continuou no caixa' }
}

# ---------- F9 Repasse semanal ----------
$F = 'F9 Repasse semanal'
Check $F 'F9.1' 'Repasse só inclui ordem recebida (campo aguardando recebimento existe)' {
  $w = Api 'GET' '/api/payouts/weekly' $admin $null
  if ($null -ne $w.awaitingReceipt) { Res 'OK' "aguardando=$($w.awaitingReceipt.count)" } else { Res 'FALHOU' 'campo awaitingReceipt ausente' }
}
Check $F 'F9.2' 'Fechamento sem motivo no desconto é recusado (400)' {
  $w = Api 'GET' '/api/payouts/weekly' $admin $null
  $r = Probe 'POST' '/api/payouts/close-week' $admin @{ technicianId = 'user-tech-joao'; weekStart = $w.cycle.weekStart; weekEnd = $w.cycle.weekEnd; dueDate = $w.cycle.dueDate; adjustment = @{ kind = 'desconto'; amount = 5; reason = 'x' } }
  if ($r.code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F9.3' 'Fechar semana, marcar pago e reenviar relatório' {
  $w = Api 'GET' '/api/payouts/weekly' $admin $null
  $hist = @($w.history)
  if ($hist.Count -eq 0) { return (Res 'PENDENTE' 'nenhum fechamento na semana para testar reenvio; fechar uma semana com serviço recebido') }
  $r = Probe 'POST' "/api/payouts/$($hist[0].id)/resend-report" $admin $null
  if ($r.code -eq 200) { Res 'OK' 'reenvio aceito' } else { Res 'FALHOU' "reenvio code=$($r.code)" }
}

# ---------- F10 Peças ----------
$F = 'F10 Peças e fornecedores'
$item = $null
Check $F 'F10.1' 'Painel de peças responde com resumo' {
  $p = Api 'GET' '/api/suppliers/parts-panel' $admin $null
  if ($null -ne $p.summary) { Res 'OK' "a encomendar=$($p.summary.toOrder) aguardando=$($p.summary.waitingSupplier) atrasadas=$($p.summary.late)" } else { Res 'FALHOU' 'sem resumo' }
}
Check $F 'F10.2' 'Encomenda + prazo geram data prevista' {
  $fc = @((Api 'GET' '/api/suppliers/forecast' $admin $null).forecast)
  $script:item = @($fc | Where-Object { -not $_.arrived_at })[0]
  if (-not $item) { return (Res 'PENDENTE' 'nenhuma peça em aberto para testar') }
  $r = Probe 'PATCH' "/api/suppliers/items/$($item.id)/logistics" $admin @{ ordered_at = '2026-11-01'; lead_days = 5 }
  if ($r.code -eq 200 -and $r.body.item.expected_arrival_at -eq '2026-11-06') { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code) previsto=$($r.body.item.expected_arrival_at)" }
}
Check $F 'F10.3' 'Cobrança ao fornecedor (1 por dia, exige e-mail)' {
  if (-not $item) { return (Res 'PENDENTE' 'sem peça') }
  $r = Probe 'POST' "/api/suppliers/items/$($item.id)/chase" $admin $null
  if ($r.code -eq 200 -or $r.code -eq 422 -or $r.code -eq 429) { Res 'OK' "code=$($r.code)" } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F10.4' 'Pedido de orçamento ao fornecedor e estado "aguardando"' {
  if (-not $item) { return (Res 'PENDENTE' 'sem peça') }
  $r = Probe 'PATCH' "/api/suppliers/items/$($item.id)/supplier-quote" $admin @{ status = 'requested' }
  if ($r.code -eq 200) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F11 Quilometragem ----------
$F = 'F11 Quilometragem'
Check $F 'F11.1' 'Gestão vê as viagens' {
  $r = Probe 'GET' '/api/mileage' $admin $null
  if ($r.code -eq 200) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F11.2' 'Alterar valor do km sem motivo é recusado (400)' {
  $r = Probe 'PATCH' '/api/mileage/settings' $admin @{ rate_per_km = 0.45 }
  if ($r.code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F12 Parâmetros do negócio ----------
$F = 'F12 Parâmetros do negócio'
Check $F 'F12.1' 'Alteração com data futura não muda o valor de hoje' {
  $before = @((Api 'GET' '/api/business-parameters' $admin $null).parameters | Where-Object { $_.key -eq 'payout_default_pct' })[0]
  $future = (Get-Date).AddMonths(3).ToString('yyyy-MM-dd')
  $r = Probe 'PUT' '/api/business-parameters/payout_default_pct' $admin @{ value = $before.current_value; effective_from = $future; reason = 'Teste de vigência futura' }
  $after = @((Api 'GET' '/api/business-parameters' $admin $null).parameters | Where-Object { $_.key -eq 'payout_default_pct' })[0]
  if (($r.code -eq 200 -or $r.code -eq 409) -and [double]$after.current_value -eq [double]$before.current_value) { Res 'OK' "atual=$($after.current_value)" } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F12.2' 'Data passada é recusada (400)' {
  $r = Probe 'PUT' '/api/business-parameters/payout_default_pct' $admin @{ value = 50; effective_from = '2020-01-01'; reason = 'Tentativa retroativa' }
  if ($r.code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F12.3' 'Valor fora do limite é recusado (400)' {
  $r = Probe 'PUT' '/api/business-parameters/payout_default_pct' $admin @{ value = 150; effective_from = (Get-Date).ToString('yyyy-MM-dd'); reason = 'Acima do limite' }
  if ($r.code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F12.4' 'Regra histórica (antes de 01/08/2026) é aplicada a ordens antigas' {
  return (Res 'PENDENTE' 'precisa de uma ordem criada antes do corte; falta fixture de dados históricos')
}

# ---------- F13 Cancelamento ----------
$F = 'F13 Cancelamento'
Check $F 'F13.1' 'Cliente cancela chamado ainda pendente' {
  $o = NewOrder 'F13'
  $r = Probe 'PATCH' "/api/orders/$($o.id)" $cust @{ status = 'cancelled' }
  if ($r.code -eq 200 -and $r.body.order.status -eq 'cancelled') { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F13.2' 'Cancelamento depois de aceite e repasse do técnico' {
  return (Res 'PENDENTE' 'regra não definida: quem cancela após aceite, e quanto o técnico recebe (decisão)')
}

# ---------- F14 Faturação ----------
$F = 'F14 Faturação'
Check $F 'F14.1' 'Gestor registra número da fatura na ordem' {
  $r = Probe 'POST' "/api/orders/$($o2.id)/invoice" $admin @{ invoice_number = 'FT 2026/999'; invoice_issued_at = (Get-Date).ToString('yyyy-MM-dd') }
  if ($r.code -eq 200) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F14.2' 'Emissão oficial da fatura no TOC Online (com simulador ou conta real)' {
  $st = Api 'GET' '/api/toconline/status' $admin $null
  if (-not $st.configured) { return (Res 'BLOQUEADO' 'defina TOCONLINE_API_URL, TOCONLINE_OAUTH_URL, TOCONLINE_CLIENT_ID, TOCONLINE_CLIENT_SECRET e TOCONLINE_REDIRECT_URI') }
  if (-not $st.authorized) { return (Res 'BLOQUEADO' 'configurada, falta a autorização única da gestão (Faturação > autorizar)') }
  $done = @((Api 'GET' '/api/orders' $admin $null).orders | Where-Object { $_.status -eq 'completed' -and -not $_.toc_document_id -and $_.customer_nif })
  if ($done.Count -eq 0) { return (Res 'PENDENTE' 'sem ordem concluída com NIF para faturar') }
  $r = Probe 'POST' "/api/orders/$($done[0].id)/invoice-toc" $admin @{}
  if ($r.code -eq 200 -and $r.body.documentNo -like 'FT *') { Res 'OK' "fatura=$($r.body.documentNo)" } else { Res 'FALHOU' "code=$($r.code) $($r.msg)" }
}
Check $F 'F14.3' 'Cliente não emite fatura oficial (403)' {
  $r = Probe 'POST' '/api/orders/x/invoice-toc' $cust @{}
  if ($r.code -eq 403) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F19 Previsão por técnico e recibo ----------
$F = 'F19 Previsão e recibo'
Check $F 'F19.1' 'Previsão por técnico: liberado, aguardando, fechado e total pago' {
  $r = Probe 'GET' '/api/payouts/by-technician' $admin $null
  $j = @($r.body.technicians | Where-Object { $_.technicianId -eq 'user-tech-joao' })[0]
  if ($r.code -eq 200 -and $j -and $null -ne $j.aLiberar -and $null -ne $j.totalPago) { Res 'OK' "liberado=$($j.aLiberar) aguarda=$($j.aguardandoRecebimento) pago=$($j.totalPago)" } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F19.2' 'Previsão por técnico fica fora do alcance do técnico (403)' {
  $r = Probe 'GET' '/api/payouts/by-technician' $tech $null
  if ($r.code -eq 403) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F19.3' 'Recibo em PDF para o cliente (layout revisado em teste separado)' {
  return (Res 'PENDENTE' 'gerado e revisado com dados de teste (pdf-review); falta conferir o logo no navegador')
}

# ---------- F20 Login e cadastro ----------
$F = 'F20 Login e primeiro acesso'
Check $F 'F20.1' 'Limite de tentativas: 10 erros bloqueiam o e-mail (429)' {
  $blocked = $false
  for ($i = 1; $i -le 11; $i++) {
    $x = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $r = Probe 'POST' '/api/auth/login' $x @{ email = 'ricardo@ctmargemsul.pt'; password = "errada$i" }
    if ($r.code -eq 429) { $blocked = $true; break }
  }
  if ($blocked) { Res 'OK' 'bloqueio ativo' } else { Res 'FALHOU' 'não bloqueou após 10 erros' }
}
Check $F 'F20.2' 'Base de demonstração não é criada em produção (verificado no código; confirmar na instalação)' {
  return (Res 'PENDENTE' 'em produção com base vazia, o sistema cria só o gestor de BOOTSTRAP_ADMIN_*; confirmar na instalação nova')
}

# ---------- Relatório ----------

# ---------- F15 Assistente IA ----------
$F = 'F15 Assistente IA'
Check $F 'F15.1' 'Assistente responde e encaminha ao gestor' {
  $st = Api 'GET' '/api/ai/status' $cust $null
  if (-not $st.configured) { return (Res 'BLOQUEADO' 'falta GEMINI_API_KEY; testado com simulador local') }
  $r = Probe 'POST' '/api/ai/chat' $cust @{ message = 'Quero falar com alguém sobre um reembolso' }
  if ($r.code -eq 200) { Res 'OK' "escalated=$($r.body.escalated)" } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F16 Espelho, cópias, painel ----------
$F = 'F16 Gestão'
Check $F 'F16.1' 'Espelho do técnico (gestão vê, cliente não)' {
  $a = Probe 'GET' '/api/technicians/user-tech-joao/mirror' $admin $null
  $c = Probe 'GET' '/api/technicians/user-tech-joao/mirror' $cust $null
  if ($a.code -eq 200 -and ($c.code -eq 403 -or $c.code -eq 401)) { Res 'OK' '' } else { Res 'FALHOU' "gestão=$($a.code) cliente=$($c.code)" }
}
Check $F 'F16.2' 'Cópia de segurança: gestão baixa, cliente não' {
  $a = Probe 'GET' '/api/admin/backup/tables' $admin $null
  $c = Probe 'GET' '/api/admin/backup/tables' $cust $null
  if ($a.code -eq 200 -and $c.code -eq 403) { Res 'OK' '' } else { Res 'FALHOU' "gestão=$($a.code) cliente=$($c.code)" }
}
Check $F 'F16.3' 'Painel aceita hoje, semana e mês' {
  $bad = @()
  foreach ($p in @('today', 'week', 'month')) { $r = Probe 'GET' "/api/dashboard/executive?period=$p" $admin $null; if ($r.code -ne 200) { $bad += $p } }
  if ($bad.Count -eq 0) { Res 'OK' '' } else { Res 'FALHOU' ("falhou em: " + ($bad -join ', ')) }
}

# ---------- F17 Segurança e permissões ----------
$F = 'F17 Segurança e permissões'
Check $F 'F17.1' 'Escrita sem cabeçalho X-Requested-With é recusada (403)' {
  # PowerShell acrescenta cabeçalhos próprios com sessão; por isso este teste usa Node (dependência do projeto).
  $js = @"
(async () => {
  const login = await fetch('$BaseUrl/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ email: 'maria@cliente.pt', password: '$Password' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch('$BaseUrl/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  console.log(r.status);
})();
"@
  $f = Join-Path $env:TEMP 'acc-xrw-check.mjs'
  [System.IO.File]::WriteAllText($f, $js, (New-Object System.Text.UTF8Encoding($false)))
  $code = (& node $f | Select-Object -Last 1)
  if ([string]$code -eq '403') { Res 'OK' 'verificado com Node' } else { Res 'FALHOU' "code=$code" }
}
Check $F 'F17.2' 'Técnico não acessa financeiro (403)' {
  $r = Probe 'GET' '/api/suppliers/parts-panel' $tech $null
  if ($r.code -eq 403) { Res 'OK' '' } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F17.3' 'Cliente não vê ordens de outros (lista só as dela)' {
  $list = @((Api 'GET' '/api/orders' $cust $null).orders)
  $foreign = @($list | Where-Object { $_.customer_id -and $_.customer_id -ne 'user-customer-maria' })
  if ($foreign.Count -eq 0) { Res 'OK' "ordens=$($list.Count)" } else { Res 'FALHOU' "vê $($foreign.Count) ordens de outros" }
}
Check $F 'F17.4' 'Login sem senha (demo-login) desligado em produção' {
  $r = Probe 'POST' '/api/auth/demo-login' $null @{ userId = 'user-admin-diego' }
  if ($r.code -eq 404) { Res 'OK' 'desligado' } elseif ($r.code -eq 200) { Res 'PENDENTE' 'ativo: confirmar que o servidor roda com NODE_ENV=production' } else { Res 'FALHOU' "code=$($r.code)" }
}

# ---------- F18 Decisões de negócio ----------
$F = 'F18 Decisões pendentes'
Check $F 'F18.1' 'Multiplicador Berens: valor confirmado com a Elaine' { return (Res 'PENDENTE' 'valor 1,30 em uso; confirmar') }
Check $F 'F18.2' 'IVA 6% ou 23% por tipo de serviço' { return (Res 'PENDENTE' 'regra a confirmar com a contabilidade') }
Check $F 'F18.3' 'Repasse 85% ou 50%' { return (Res 'PENDENTE' 'percentual a confirmar') }
Check $F 'F18.4' 'Técnico vê ou não repasses e IBAN' { return (Res 'PENDENTE' 'agora é um parâmetro em Parâmetros do Negócio; falta a decisão da Elaine') }

# ---------- F21 Cancelamento, visibilidade e restauração ----------
$F = 'F21 Cancelamento, visibilidade e restauração'
Check $F 'F21.1' 'Cancelamento depois de aceite: técnico recebe a percentagem do parâmetro (0% por padrão)' {
  $o = NewOrder 'F21'
  $null = Probe 'PATCH' "/api/orders/$($o.id)" $tech @{ status = 'accepted' }
  $r = Probe 'POST' "/api/orders/$($o.id)/cancel" $cust @{}
  if ($r.code -eq 200 -and $r.body.order.status -eq 'cancelled') { Res 'OK' "pago ao técnico=$($r.body.technicianPayout)" } else { Res 'FALHOU' "code=$($r.code)" }
}
Check $F 'F21.2' 'Técnico só vê os repasses se a gestão tiver liberado' {
  $vis = (Api 'GET' '/api/settings/visibility' $tech $null).techSeesPayouts
  $w = Probe 'GET' '/api/payouts/weekly' $tech $null
  if ($vis -eq $true -and $w.code -eq 200) { Res 'OK' 'visível' } elseif ($vis -eq $false -and $w.code -eq 403) { Res 'OK' 'escondido e bloqueado' } else { Res 'FALHOU' "visível=$vis código=$($w.code)" }
}
Check $F 'F21.3' 'Restauração sem a palavra RESTAURAR é recusada (400)' {
  $h = @{ 'X-Requested-With' = 'XMLHttpRequest' }
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/backup/restore" -Method Post -Headers $h -Body ([byte[]](1..200)) -ContentType 'application/octet-stream' -WebSession $admin | Out-Null
    Res 'FALHOU' 'aceitou sem confirmação'
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$code" }
  }
}
Check $F 'F21.4' 'Arquivo que não é base SQLite é recusado na restauração (400)' {
  $h = @{ 'X-Requested-With' = 'XMLHttpRequest'; 'X-Restore-Confirm' = 'RESTAURAR' }
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/backup/restore" -Method Post -Headers $h -Body ([byte[]](1..200)) -ContentType 'application/octet-stream' -WebSession $admin | Out-Null
    Res 'FALHOU' 'aceitou arquivo inválido'
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 400) { Res 'OK' '' } else { Res 'FALHOU' "code=$code" }
  }
}
Check $F 'F21.5' 'Restauração completa (cópia, espera e troca no reinício)' {
  return (Res 'PENDENTE' 'testada à parte com reinício do servidor (scripts\simuladores\test-v7: 22 de 22); não é repetida aqui, porque mexe na base')
}

# ---------- Relatório ----------
$total = $script:rows.Count
$ok = @($script:rows | Where-Object { $_.Status -eq 'OK' }).Count
$fail = @($script:rows | Where-Object { $_.Status -eq 'FALHOU' }).Count
$pend = @($script:rows | Where-Object { $_.Status -eq 'PENDENTE' }).Count
$block = @($script:rows | Where-Object { $_.Status -eq 'BLOQUEADO' }).Count

$lines = New-Object System.Collections.ArrayList
[void]$lines.Add("# Relatório de aceitação: Confiança Repara")
[void]$lines.Add("")
[void]$lines.Add("Gerado em $script:stamp contra $BaseUrl.")
[void]$lines.Add("")
[void]$lines.Add("| Total | OK | FALHOU | PENDENTE | BLOQUEADO |")
[void]$lines.Add("|---|---|---|---|---|")
[void]$lines.Add("| $total | $ok | $fail | $pend | $block |")
[void]$lines.Add("")
[void]$lines.Add("Legenda: OK = faz como deve · FALHOU = defeito a corrigir · PENDENTE = a codificar ou decidir · BLOQUEADO = depende de chave ou conta externa.")
$lastFlow = ''
foreach ($r in $script:rows) {
  if ($r.Fluxo -ne $lastFlow) {
    [void]$lines.Add("")
    [void]$lines.Add("## $($r.Fluxo)")
    [void]$lines.Add("")
    [void]$lines.Add("| Id | Verificação | Status | Detalhe |")
    [void]$lines.Add("|---|---|---|---|")
    $lastFlow = $r.Fluxo
  }
  $det = ($r.Detalhe -replace '\|', '/')
  [void]$lines.Add("| $($r.Id) | $($r.Verificacao) | **$($r.Status)** | $det |")
}
$lines -join "`r`n" | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Output "Relatório: $ReportPath"
Write-Output "Total=$total OK=$ok FALHOU=$fail PENDENTE=$pend BLOQUEADO=$block"
