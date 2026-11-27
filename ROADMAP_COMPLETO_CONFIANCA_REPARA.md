# Roadmap & Checklist Completo — Plataforma Confiança Repara

Este documento consolida o plano de evolução ideal para tornar a **Plataforma Confiança Repara** 100% pronta para produção comercial em Portugal — unindo a arquitetura modular do projeto novo, os recursos operacionais maduros do **Projeto Base** e todas as atualizações alinhadas nas **Conversas com Diego e Elaine**.

---

## Estado Atual (Já Implementado na Nova Base)

Antes de iniciar os próximos passos, esta base já está construída e validada:

- [x] **Arquitetura Multi-Portal com Rotas Dedicadas (Deep-Linking):**
  - `/admin/*` (Super Admin / Gestor Confiança)
  - `/empresa/*` (Empresa Cliente / Centro Técnico com equipa própria)
  - `/parceiro/*` (Empresa Parceira Contratante, ex.: Berens — sem visão de margem interna)
  - `/tecnico/*` (Técnico autónomo ou vinculado, vendo o ganho antes de aceitar)
  - `/cliente/*` (Cliente Final B2C)
- [x] **Motor Financeiro Único e Testado (`src/core/finance/`):**
  - Segregação de IVA Portugal (`6%` vs `23%`) partilhada entre UI e backend.
  - Regra de repasse vigente (`50% Taxa de Serviço + 50% M.O. + 50% Taxa Extra`, `0%` peças, exceções de `quote_status = 'rejected'`, `is_warranty`, percentual customizado para Centros Técnicos e trava `payout_locked`).
  - Regra legada Berens (`legacy_parts_markup` anterior a `15/06/2026`).
  - 9 testes unitários automatizados a passar.
- [x] **Ciclo Semanal Fixo (Domingo–Sábado → Pagamento na Sexta seguinte):**
  - Substitui o antigo fluxo de lotes manuais.
  - Aviso fiscal obrigatório com dados completos (**Confiança e Versatilidade Unipessoal Lda — NIF 518646696 — Corroios**).
  - Ação **"Marcar como Pago"** atualizando simultaneamente **Contas a Pagar** e **Fluxo de Caixa**.
- [x] **Regras Operacionais Atualizadas (Nov/2026):**
  - **Fornecedores** como previsão automática de caixa ao aprovar orçamento, com campo de fornecedor **opcional** na ordem de serviço.
  - **"Quero o mesmo técnico"** a partir do 2.º pedido do cliente final.
  - **Segurança & RBAC:** Cadastro atômico, `scrypt` + sessão assinada, e filtragem de campos sensíveis por perfil diretamente na API.

---

## Ordem Ideal de Execução (Checklist Priorizado)

> A ordem abaixo evita retrabalho: primeiro fecha regras financeiras e lacunas operacionais no app; depois liga integrações externas reais (Stripe, Resend, Google Agenda, Maps); por fim prepara escala comercial (i18n, PWA, migração Postgres e Go-Live).

---

### Fase 1 — Fechamento de Regras Financeiras e Auditoria (Prioridade Máxima)

Garante zero divergência de cêntimos, histórico protegido e paridade total com o que Elaine e a contabilidade precisam.

- [x] **1.1. Botão "Reenviar Relatório" no Fechamento Semanal**
  - Na lista de fechamentos em estado pendente (`report_sent` / aguardando pagamento), exibir botão **"Reenviar relatório"** para reenvio rápido por e-mail ao técnico/centro técnico (conforme especificado pela Elaine em 13/11).
- [x] **1.2. Repasse Proporcional & Anti-Duplicação (`labor_paid_at` / `materials_paid_at`)**
  - Portar lógica de `computeProportionalPayout` e marcadores independentes de pagamento para serviços com pagamentos parciais/acréscimos, garantindo que nenhum componente já pago seja cobrado ou repassado duas vezes.
- [x] **1.3. Regra de Corte Temporal Legada (`PAYOUT_RULE_CUTOFF`)**
  - Suportar preservação automática da regra antiga (`70% M.O./Extra + 50% lucro de peças`) para serviços históricos importados anteriores à data de corte configurável, sem afetar ordens novas.
- [x] **1.4. Painel de Configuração de Taxas Base (`PayoutRatesSettings`)**
  - Permitir ao Super Admin editar no painel as taxas padrão de deslocação/serviço (`WO`, `SR`, `CO`, Esquentador reparação `€85`, Esquentador instalação `€75`, Demais serviços `€55`) com histórico de alteração.
- [x] **1.5. Centro de Administração e Reconciliação (`AdminReconciliationPanel`)**
  - Tela exclusiva do Super Admin para analisar e corrigir divergências entre valores de chamados ainda em aberto e os respectivos fechamentos semanais / contas a pagar, **nunca alterando histórico já pago**.

---

### Fase 2 — Completude Operacional de Campo e Gestão

Traz para a arquitetura modular nova todas as ferramentas de produtividade diária que existiam no sistema antigo.

- [x] **2.1. Upload Real de Fotos Privadas (Antes / Durante / Depois / Faturas)**
  - Substituir referências textuais por upload real de imagens no chamado (com compressão no cliente, armazenamento em storage privado com URL assinada e visualização em galeria/lightbox).
- [x] **2.2. Agenda Mensal/Semanal em Grade (`GestorAgenda`)**
  - Criar visualização de calendário interativo no `/admin/agenda` e `/empresa/agenda` exibindo atendimentos iniciais **e retornos de garantia (`return_visits`)**, com filtro por técnico e clique direto para abrir `/admin/servicos/:id`.
- [x] **2.3. Espelho do Técnico (`TechnicianMirrorView`)**
  - Permitir ao Super Admin (e ao Gestor de Centro Técnico sobre os seus próprios técnicos) abrir uma visão somente-leitura exatamente como o técnico enxerga: disponíveis, agenda, ganhos e notificações.
- [x] **2.4. Aba de Avaliações (`Ratings`) e Arquivo / Lixeira (`Deleted`)**
  - Painel dedicado de avaliações de clientes (média geral, distribuição 5★–1★, filtro por técnico e comentário ligado ao chamado).
  - Soft-delete / lixeira de chamados cancelados/eliminados com restauração pelo Super Admin.
- [x] **2.5. Fluxo Completo de Conta e Recuperação de Senha**
  - Páginas `/esqueci-senha` e `/redefinir-senha` com token expirável.
  - Edição completa de perfil para Técnico (IBAN, NIF, morada, foto) e Cliente/Parceiro.

---

### Fase 3 — ERP Financeiro & Exportação Profissional (PDF / Excel)

Eleva o financeiro de "controle básico" para nível contábil português completo.

- [x] **3.1. Contas a Pagar Completo (`AccountsPayablePanel`)**
  - Suporte a despesas **avulsas, recorrentes** (`semanal`, `mensal`, `trimestral`, `semestral`, `anual`) e **parceladas** (com geração automática das próximas parcelas).
  - Suporte a **pagamento parcial**, vencimento automático (`atrasado`/`vencido`), anexo de comprovante e as 18 categorias operacionais PT (`Salários`, `Segurança Social`, `Combustível`, `Portagem`, `Contabilidade`, `Veículos`, `Impostos`, etc.).
- [x] **3.2. Exportação Profissional em PDF e XLSX (`jsPDF` + `xlsx`)**
  - **Relatório Geral de Serviços:** filtros por período, status, técnico e escopo (`WO`/`SR`/`CO`/`PARTNER`), com seleção personalizada de colunas.
  - **Relatório Mensal de Empresa Parceira (`CompanyReport`):** PDF/Excel limpo para parceiras (ex.: Berens) com n.º de fatura, data, morada, deslocação, M.O., peças e IVA — **sem margem nem repasse interno**.
  - **Recibo/Relatório Semanal de Técnico:** PDF oficial contendo os serviços da semana e o bloco fiscal obrigatório da **Confiança e Versatilidade Unipessoal Lda (NIF 518646696)**.
  - **Relatório de Contas a Pagar e Quilometragem (`€0,40/km`).**

---

### Fase 4 — Integrações Reais de Produção (Fim dos Mocks)

Substitui simulações locais por provedores oficiais com segurança de servidor.

- [x] **4.1. Stripe Real Blindada (Checkout + Webhook + Reconciliação)**
  - Criar sessão de pagamento exclusivamente no servidor usando o total calculado pelo motor único (`calculator.ts`).
  - **Regra crítica (bug antigo):** nunca confirmar pagamento pelo redirect da URL; confirmar apenas via webhook assinado da Stripe (`checkout.session.completed`).
  - Implementar rotina/botão **"Verificar pagamentos pendentes"** consultando a API da Stripe caso o cliente feche a aba antes do retorno (`/pagamento-sucesso`).
- [x] **4.2. E-mails Transacionais Reais (Resend)**
  - Boas-vindas ao cliente/técnico, confirmação de chamado, envio/aprovação de orçamento, aprovação de peça/material, confirmação de pagamento, envio/reenvio do relatório semanal ao técnico e **Disparo em Massa (`Broadcast`)** do Gestor.
- [x] **4.3. Google Agenda Real (OAuth / Sync Bidirecional)**
  - Substituir links/IDs simulados por criação, atualização e cancelamento reais de eventos na Google Agenda quando um chamado é atribuído, reagendado ou tem retorno de garantia, com geração automática de `.ics`.
- [x] **4.4. GPS & ETA em Tempo Real (Google Maps)**
  - Solicitação guiada de permissão de GPS no painel do técnico ao marcar *"A caminho"* (`on_the_way`).
  - Cálculo real de distância e tempo estimado de chegada (`ETA`) para exibir ao cliente final e registar deslocação/km com precisão.

---

### Fase 5 — Experiência Comercial, Escala e Go-Live

Prepara a plataforma para operação pública diária com dezenas de técnicos e clientes B2C/B2B.

- [x] **5.1. Multi-Idioma (`i18n`: Português, Inglês e Espanhol)**
  - Implementar `PT / EN / ES` com seletor no cabeçalho (essencial para clientes estrangeiros em Lisboa, Margem Sul e Setúbal e para a equipa interna).
- [x] **5.2. PWA Instalável e Notificações em Tempo Real**
  - Manifesto PWA (`vite-plugin-pwa`), Service Worker offline básico e botão *"Instalar App"* para técnicos e clientes no telemóvel.
  - WebSockets (`/ws`) para chat interno e alertas instantâneos de novos chamados/ETA sem precisar dar F5.
- [x] **5.3. Catálogo Expandido & Estratégia Site vs. App**
  - Manter o **site institucional/SEO** (`confiancamanutencao.com`) separado do subdomínio da **aplicação** (`app.*`) para evitar conflitos de DNS/redirecionamento.
  - Incorporar novas categorias comerciais (Limpeza incl. plano mensal `€49,99`, Controlo de Pragas, Jardinagem, Pintura, Estética/Bem-estar, Montagens IKEA/Estores) e os posicionamentos aprovados pelo Diego (*"Garantia de 6 meses em eletrodomésticos"*, *"Atendimento e agendamento todos os dias"*).
- [x] **5.4. Migração de Banco para Produção & Importação do Histórico**
  - Schema DDL PostgreSQL/Supabase (`db/postgres/schema.sql`) e guia operacional (`MIGRACAO_POSTGRES_SUPABASE.md`) prontos para produção.
  - Script idempotente de importação dos dados históricos (`scripts/import-legacy-history.ts`) preservando `legacy_parts_markup` (< `15/06/2026`), valores pagos e ciclos fechados.
- [x] **5.5. Checklist Final de Homologação (Pré-Lançamento)**
  - [x] Testes automatizados (`calculator.test.ts` + `scripts/e2e-suite.ts` com fluxo E2E completo, WebSocket, webhook Stripe, PDF/XLSX e RBAC).
  - [x] Variáveis de ambiente e chaves Stripe/Resend/Google configuradas apenas no servidor (zero segredo no frontend).
  - [x] Teste ponta a ponta cobrindo os 5 perfis operacionais (Admin, Centro Técnico, Parceiro Berens, Técnico e Cliente Particular).
