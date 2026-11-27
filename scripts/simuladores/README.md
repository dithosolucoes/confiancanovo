# Simuladores e chaves falsas (só para teste)

Estes arquivos testam as integrações sem conta real, sem internet e sem nenhuma chave verdadeira.
Nenhuma credencial aqui é real. Não use estes valores em produção.

## Chaves falsas usadas

| Variável | Valor de teste | Para quê |
|---|---|---|
| `GEMINI_API_KEY` | `test-key-fake` | assistente IA (simulador `gemini-sim.js`, porta 4010) |
| `GEMINI_BASE_URL` | `http://localhost:4010` | aponta o assistente para o simulador |
| `STRIPE_SECRET_KEY` | `sk_test_fake_local_only` | cria o cliente Stripe sem chamar a Stripe |
| `STRIPE_WEBHOOK_SECRET` | `whsec_test_local_fake` | assina e verifica eventos do webhook (`stripe-sign.js`) |
| `TOCONLINE_CLIENT_ID` | `fake-client` | autorização da TOConline (simulador `sim-servers.js`, porta 4020) |
| `TOCONLINE_CLIENT_SECRET` | `fake-secret-local` | troca de tokens |
| `TOCONLINE_API_URL` | `http://localhost:4020/api` | API simulada |
| `TOCONLINE_OAUTH_URL` | `http://localhost:4020/oauth` | autenticação simulada |
| `TOCONLINE_REDIRECT_URI` | `http://localhost:3000/api/toconline/callback` | retorno da autorização |
| `RESEND_API_KEY` | `re_fake_local_only` | e-mails (simulador `sim-servers.js`, porta 4011) |
| `RESEND_BASE_URL` | `http://localhost:4011` | aponta o envio para o simulador |

## Como rodar

1. Simuladores de TOConline e Resend (uma janela):

   ```powershell
   node scripts\simuladores\sim-servers.js
   ```

2. Servidor com as variáveis falsas (outra janela, na pasta do projeto):

   ```powershell
   $env:TOCONLINE_API_URL='http://localhost:4020/api'; $env:TOCONLINE_OAUTH_URL='http://localhost:4020/oauth'; $env:TOCONLINE_CLIENT_ID='fake-client'; $env:TOCONLINE_CLIENT_SECRET='fake-secret-local'; $env:TOCONLINE_REDIRECT_URI='http://localhost:3000/api/toconline/callback'; $env:RESEND_API_KEY='re_fake_local_only'; $env:RESEND_BASE_URL='http://localhost:4011'; npx tsx server.ts
   ```

3. Teste da TOConline e do e-mail:

   ```powershell
   node scripts\simuladores\test-toc.mjs
   ```

## O que o simulador prova e o que não prova

- **Prova:** que o código monta as chamadas certas, trata erros, guarda o número do documento e não emite duas vezes.
- **Não prova:** que a TOConline real aceita exatamente esses campos. A documentação pública não confirma o caminho das linhas de fatura, nem o endereço base e o endereço de login, que ficam nas configurações da conta. Esses pontos estão marcados como "a confirmar" em `server/toconline.ts`.
- Gemini e Stripe: os simuladores validam a forma das chamadas, não a resposta real do serviço.
