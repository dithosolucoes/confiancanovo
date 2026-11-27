# Confiança Repara

Sistema de gestão para assistência técnica de eletrodomésticos. Centraliza pedidos, orçamentos, agenda, repasses a técnicos, caixa, fornecedores e relatórios, com um portal próprio para cada perfil de usuário.

## Perfis de acesso

| Perfil | O que faz no sistema |
|---|---|
| Super administrador | Gestão completa: parâmetros, técnicos, organizações, clientes, repasses, caixa, backup e chaves de integração |
| Administração da empresa | Acompanha ordens, técnicos e repasses da própria empresa |
| Técnico | Mural de serviços, agenda, orçamentos, quilometragem e ganhos |
| Cliente | Agenda serviços, acompanha ordens, aprova orçamentos, paga e avalia |
| Parceiro | Abre pedidos para os seus clientes e acompanha relatórios mensais |

## Principais funcionalidades

- Pedidos com ciclo completo: aceite, agendamento, orçamento, execução, pagamento e conclusão
- Repasse semanal aos técnicos, com fechamento, pagamento e relatório
- Caixa com lançamentos, parcelamentos, recorrências e vencimentos
- Controle de peças e fornecedores, com cobrança e alertas de atraso
- Quilometragem com tarifa vigente por data
- Assinaturas recorrentes
- Relatórios em PDF e Excel
- Agenda com exportação de calendário (.ics)
- Parâmetros de negócio com vigência, editáveis pela gestão
- Backup e restauração da base de dados

## Tecnologias

- **Front-end:** React, TypeScript, Vite, Tailwind CSS
- **Back-end:** Node.js, Express, TypeScript
- **Banco de dados:** SQLite (better-sqlite3)
- **Integrações:** Stripe (pagamentos), Resend (e-mail), TOConline (faturação), Google Maps e Google Calendar, Gemini (assistente)

## Como rodar localmente

Pré-requisito: Node.js 20 ou superior.

```bash
npm install
cp .env.example .env
npm run dev
```

O sistema sobe em `http://localhost:3000`.

Para rodar a verificação de tipos:

```bash
npm run lint
```

## Variáveis de ambiente

Todas ficam no arquivo `.env` (use `.env.example` como modelo). Nunca faça commit do `.env`.

| Variável | Para que serve |
|---|---|
| `NODE_ENV` | `production` em ambiente publicado. Desativa os atalhos de teste |
| `SESSION_SECRET` | Chave longa e aleatória para assinar as sessões |
| `APP_URL` | Endereço público do sistema |
| `DATA_DIR` | Pasta onde fica o banco SQLite (use um volume persistente em produção) |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | Primeiro administrador, criado quando o banco está vazio |
| `SEED_DEMO` | `1` para criar dados de demonstração |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagamentos |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Envio de e-mails |
| `TOCONLINE_*` | Faturação oficial |
| `GOOGLE_MAPS_API_KEY` | Distâncias e rotas |
| `GOOGLE_CALENDAR_CLIENT_ID` | Sincronização com o Google Calendar |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Assistente de atendimento |

Sem uma chave de integração, a funcionalidade correspondente fica desativada e o restante do sistema continua funcionando.

## Publicação

1. Gerar o build do front-end:
   ```bash
   npm run build
   ```
2. Iniciar o servidor em produção:
   ```bash
   npm run start
   ```

Em produção, o banco deve ficar num volume persistente, apontado por `DATA_DIR`. Sem isso, os dados são perdidos a cada novo deploy.

## Testes e verificação

- `scripts/acceptance/Run-Acceptance.ps1`: roteiro de aceitação, com os fluxos principais de cada perfil.
- `scripts/simuladores/`: simuladores locais de Stripe, TOConline, Resend e Gemini, para testar integrações sem chaves reais. Veja o README da pasta.

## Backup

A gestão pode baixar a base de dados pela tela de backup. Recomenda-se fazer cópias periódicas e guardá-las fora do servidor.

## Licença

Todos os direitos reservados.
