# Migração de Produção — SQLite (`confianca.db`) → PostgreSQL / Supabase

Este documento descreve o fluxo oficial para subir a **Confiança Repara** para ambiente de produção com PostgreSQL / Supabase mantendo compatibilidade total com o motor financeiro (`src/core/finance/calculator.ts`).

## 1. Estrutura & Schema
- O schema completo de produção (tabelas, `CHECK` constraints, índices parciais para soft-delete e auditoria) encontra-se em `db/postgres/schema.sql`.
- Configure `DATABASE_URL` no `.env` de produção (ou Supabase Connection Pooler URI).

## 2. Variáveis de Ambiente Obrigatórias em Produção
```env
SESSION_SECRET="<chave-aleatoria-64-caracteres>"
DATABASE_URL="postgresql://postgres:<PASSWORD>@db.<PROJECT>.supabase.co:5432/postgres"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="Confiança Repara <no-reply@confiancamanutencao.com>"
GOOGLE_MAPS_API_KEY="AIza..."
```

## 3. Passo-a-Passo da Migração
1. **Provisionar schema no Supabase / PostgreSQL**:
   ```bash
   psql "$DATABASE_URL" -f db/postgres/schema.sql
   ```
2. **Importar histórico antigo (com preservação das regras temporais)**:
   ```bash
   npx tsx scripts/import-legacy-history.ts --file ./historico-export.json --dry-run
   npx tsx scripts/import-legacy-history.ts --file ./historico-export.json
   ```
   - Ordens anteriores a `15/06/2026` mantêm automaticamente `legacy_parts_markup = true` (×1.30 Berens).
   - Ordens anteriores a `01/08/2026` mantêm automaticamente `legacy_payout_rule = true` (`fixo + 70% mão de obra`).
3. **Configurar Webhook do Stripe**:
   - Apontar endpoint `https://app.confiancamanutencao.com/api/webhooks/stripe` para o evento `checkout.session.completed`.
   - Utilizar o botão **Verificar Pagamentos Pendentes** na Gestão / Ordem para reconciliação de sessões em aberto.
4. **Domínios**:
   - Site institucional e subscrições (`confiancamanutencao.com`) separado do domínio da app SaaS (`app.confiancamanutencao.com`).
