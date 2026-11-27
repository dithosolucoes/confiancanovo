# Relatório de aceitação: Confiança Repara

Gerado em 2026-11-22 20:09 contra http://localhost:3000.

| Total | OK | FALHOU | PENDENTE | BLOQUEADO |
|---|---|---|---|---|
| 58 | 44 | 0 | 10 | 4 |

Legenda: OK = faz como deve · FALHOU = defeito a corrigir · PENDENTE = a codificar ou decidir · BLOQUEADO = depende de chave ou conta externa.

## F1 Abertura do chamado

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F1.1 | Cliente abre o chamado (status Aguardando) | **OK** | ref=WO-2026-0114 |
| F1.2 | Gestor vê o chamado na lista | **OK** |  |
| F1.3 | Código de referência único entre dois chamados | **OK** | WO-2026-0114 / WO-2026-0115 |
| F1.4 | Tipo de aparelho e NIF gravados no chamado | **OK** | aparelho=Micro-ondas nif=198445210 |

## F2 Aceite pelo técnico

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F2.1 | Técnico aceita chamado do mural (status Aceite) | **OK** |  |
| F2.2 | Cliente não aceita pelo técnico (403) | **OK** | code=400 |

## F3 Agendamento

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F3.1 | Técnico sugere novo horário; cliente aceita | **OK** |  |

## F4 Orçamento aprovado

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F4.1 | Técnico lança orçamento e envia ao cliente | **OK** |  |
| F4.2 | Cliente aprova orçamento | **OK** |  |
| F4.3 | Repasse = percentagem × (taxa de serviço + M.O. + taxa extra) | **OK** | repasse=47.5 esperado=47.5 pct=50 |

## F5 Orçamento recusado

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F5.1 | Orçamento recusado: repasse só sobre a taxa de serviço | **OK** | repasse=27.5 |

## F6 Garantia

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F6.1 | Garantia: repasse = percentagem × (taxa de serviço + M.O.) | **OK** | repasse=42.5 |

## F7 Pagamento online

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F7.1 | Webhook da Stripe recusa evento sem assinatura | **OK** | code=503 |
| F7.2 | Pagamento assinado marca a taxa como paga (exige Stripe configurada) | **BLOQUEADO** | precisa de STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET no servidor; testado à parte com segredo fictício |
| F7.3 | Métodos de pagamento ativados na Stripe | **BLOQUEADO** | depende de ativar cada método na conta Stripe (decisão + conta) |

## F8 Recebimento e caixa

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F8.1 | Dar baixa registra recebimento | **OK** |  |
| F8.2 | Recebimento aparece no fluxo de caixa | **OK** |  |
| F8.3 | Desfazer a baixa remove a receita | **OK** |  |

## F9 Repasse semanal

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F9.1 | Repasse só inclui ordem recebida (campo aguardando recebimento existe) | **OK** | aguardando=2 |
| F9.2 | Fechamento sem motivo no desconto é recusado (400) | **OK** |  |
| F9.3 | Fechar semana, marcar pago e reenviar relatório | **OK** | reenvio aceito |

## F10 Peças e fornecedores

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F10.1 | Painel de peças responde com resumo | **OK** | a encomendar=3 aguardando=0 atrasadas=0 |
| F10.2 | Encomenda + prazo geram data prevista | **OK** |  |
| F10.3 | Cobrança ao fornecedor (1 por dia, exige e-mail) | **OK** | code=200 |
| F10.4 | Pedido de orçamento ao fornecedor e estado "aguardando" | **OK** |  |

## F11 Quilometragem

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F11.1 | Gestão vê as viagens | **OK** |  |
| F11.2 | Alterar valor do km sem motivo é recusado (400) | **OK** |  |

## F12 Parâmetros do negócio

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F12.1 | Alteração com data futura não muda o valor de hoje | **OK** | atual=50 |
| F12.2 | Data passada é recusada (400) | **OK** |  |
| F12.3 | Valor fora do limite é recusado (400) | **OK** |  |
| F12.4 | Regra histórica (antes de 01/08/2026) é aplicada a ordens antigas | **PENDENTE** | precisa de uma ordem criada antes do corte; falta fixture de dados históricos |

## F13 Cancelamento

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F13.1 | Cliente cancela chamado ainda pendente | **OK** |  |
| F13.2 | Cancelamento depois de aceite e repasse do técnico | **PENDENTE** | regra não definida: quem cancela após aceite, e quanto o técnico recebe (decisão) |

## F14 Faturação

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F14.1 | Gestor registra número da fatura na ordem | **OK** |  |
| F14.2 | Emissão oficial da fatura no TOC Online (com simulador ou conta real) | **BLOQUEADO** | defina TOCONLINE_API_URL, TOCONLINE_OAUTH_URL, TOCONLINE_CLIENT_ID, TOCONLINE_CLIENT_SECRET e TOCONLINE_REDIRECT_URI |
| F14.3 | Cliente não emite fatura oficial (403) | **OK** |  |

## F19 Previsão e recibo

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F19.1 | Previsão por técnico: liberado, aguardando, fechado e total pago | **OK** | liberado=0 aguarda=42.5 pago=77.5 |
| F19.2 | Previsão por técnico fica fora do alcance do técnico (403) | **OK** |  |
| F19.3 | Recibo em PDF para o cliente (layout revisado em teste separado) | **PENDENTE** | gerado e revisado com dados de teste (pdf-review); falta conferir o logo no navegador |

## F20 Login e primeiro acesso

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F20.1 | Limite de tentativas: 10 erros bloqueiam o e-mail (429) | **OK** | bloqueio ativo |
| F20.2 | Base de demonstração não é criada em produção (verificado no código; confirmar na instalação) | **PENDENTE** | em produção com base vazia, o sistema cria só o gestor de BOOTSTRAP_ADMIN_*; confirmar na instalação nova |

## F15 Assistente IA

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F15.1 | Assistente responde e encaminha ao gestor | **BLOQUEADO** | falta GEMINI_API_KEY; testado com simulador local |

## F16 Gestão

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F16.1 | Espelho do técnico (gestão vê, cliente não) | **OK** |  |
| F16.2 | Cópia de segurança: gestão baixa, cliente não | **OK** |  |
| F16.3 | Painel aceita hoje, semana e mês | **OK** |  |

## F17 Segurança e permissões

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F17.1 | Escrita sem cabeçalho X-Requested-With é recusada (403) | **OK** | verificado com Node |
| F17.2 | Técnico não acessa financeiro (403) | **OK** |  |
| F17.3 | Cliente não vê ordens de outros (lista só as dela) | **OK** | ordens=9 |
| F17.4 | Login sem senha (demo-login) desligado em produção | **PENDENTE** | ativo: confirmar que o servidor roda com NODE_ENV=production |

## F18 Decisões pendentes

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F18.1 | Multiplicador Berens: valor confirmado com a Elaine | **PENDENTE** | valor 1,30 em uso; confirmar |
| F18.2 | IVA 6% ou 23% por tipo de serviço | **PENDENTE** | regra a confirmar com a contabilidade |
| F18.3 | Repasse 85% ou 50% | **PENDENTE** | percentual a confirmar |
| F18.4 | Técnico vê ou não repasses e IBAN | **PENDENTE** | agora é um parâmetro em Parâmetros do Negócio; falta a decisão da Elaine |

## F21 Cancelamento, visibilidade e restauração

| Id | Verificação | Status | Detalhe |
|---|---|---|---|
| F21.1 | Cancelamento depois de aceite: técnico recebe a percentagem do parâmetro (0% por padrão) | **OK** | pago ao técnico=0 |
| F21.2 | Técnico só vê os repasses se a gestão tiver liberado | **OK** | visível |
| F21.3 | Restauração sem a palavra RESTAURAR é recusada (400) | **OK** |  |
| F21.4 | Arquivo que não é base SQLite é recusado na restauração (400) | **OK** |  |
| F21.5 | Restauração completa (cópia, espera e troca no reinício) | **PENDENTE** | testada à parte com reinício do servidor (scripts\simuladores\test-v7: 22 de 22); não é repetida aqui, porque mexe na base |
