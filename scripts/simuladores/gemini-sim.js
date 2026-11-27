// Simulador local da API generateContent do Gemini (só para teste, sem rede e sem chave real).
const http = require('http');

const PORT = 4010;
const EXPECTED_KEY = 'test-key-fake';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (!/\/v1beta\/models\/[^/]+:generateContent$/.test(req.url || '')) return json(404, { error: 'not found' });
    if (req.headers['x-goog-api-key'] !== EXPECTED_KEY) return json(403, { error: { message: 'API key invalid' } });

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(400, { error: { message: 'bad json' } });
    }
    const contents = parsed.contents || [];
    const last = contents[contents.length - 1];
    const lastText = (last?.parts?.[0]?.text || '').toLowerCase();

    if (!parsed.systemInstruction || !Array.isArray(contents) || contents.length === 0) {
      return json(400, { error: { message: 'missing contents/systemInstruction' } });
    }
    if (lastText.includes('limite')) return json(429, { error: { message: 'quota' } });

    let text = `Resposta simulada sobre: ${last?.parts?.[0]?.text || ''}`;
    if (lastText.includes('encaminhar')) {
      text = 'Entendo, esta questão requer a atenção do nosso gestor. [ENCAMINHAR_GESTOR]';
    }
    json(200, {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
      turns: contents.length,
      systemHasText: Boolean(parsed.systemInstruction?.parts?.[0]?.text),
    });
  });
});

server.listen(PORT, () => console.log(`gemini-sim em http://localhost:${PORT}`));
