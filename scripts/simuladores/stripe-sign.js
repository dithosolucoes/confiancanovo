// Gera o cabeçalho stripe-signature com um segredo fictício (usa a biblioteca oficial da Stripe).
const path = require('path');
const fs = require('fs');
const projectRoot = process.argv[2];
const payloadFile = process.argv[3];
const secret = process.argv[4];
const Stripe = require(path.join(projectRoot, 'node_modules', 'stripe'));
const stripe = new Stripe('sk_test_fake_local_only');
const payload = fs.readFileSync(payloadFile, 'utf8');
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
process.stdout.write(header);
