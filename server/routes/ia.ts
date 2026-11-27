import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';

// Assistente de IA (Gemini), movido de server.ts sem alteração de comportamento.
// As tabelas ai_conversations e ai_messages continuam sendo criadas em server.ts, no arranque, no mesmo ponto.
// Configuração lida do ambiente no momento do registro (GEMINI_MODEL), como antes, e a chave/URL no momento da chamada.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string;
}

export interface IaRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
}

export function registerIaRoutes(app: express.Express, ctx: IaRouteContext) {
  const { db, requireAuth, createNotification } = ctx;

  const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const AI_ESCALATION_TAG = '[ENCAMINHAR_GESTOR]';
  const AI_ESCALATION_REPLY =
    'Entendo, esta questão requer a atenção do nosso gestor. Vou encaminhar a sua mensagem para que entre em contacto consigo brevemente.';
  const AI_ROLE_LABELS: Record<string, string> = {
    customer: 'cliente final',
    partner_requester: 'parceiro contratante',
    technician: 'técnico',
    company_admin: 'centro técnico',
    super_admin: 'gestão',
  };

  const aiSystemPrompt = (role: string) => `Você é o assistente virtual da Confiança Repara, uma empresa de reparação e manutenção de eletrodomésticos em Portugal (Lisboa e região e Margem Sul).

Responda sempre em português de Portugal, de forma simpática, clara e curta. Não invente preços, prazos ou dados de clientes. Não peça nem repita senhas, IBAN, cartões ou NIF.

Quem fala com você: ${AI_ROLE_LABELS[role] || 'utilizador'}.

Funcionalidades da app que pode explicar:
- Pedir um serviço (cliente e parceiro): escolher o serviço do catálogo, a morada e a data. Pode haver taxa de deslocação.
- Acompanhar serviços: estados Aguardando, Aceite, A caminho, No local, Em orçamentação, Aguardando pagamento, Concluído.
- Orçamento: o técnico envia o orçamento e o cliente aprova ou recusa na própria ordem.
- Sugestão de novo horário: o cliente ou o parceiro aprova ou recusa.
- Pagamento online por cartão (Stripe) e verificação de pagamento pendente.
- Garantia: pedido de retorno em garantia dentro da ordem.
- Avaliação do serviço depois de concluído.
- Atualizar dados de perfil.
- Técnicos: mural de serviços disponíveis, agenda, quilometragem e ganhos.

Encaminhe para o gestor quando: a dúvida for sobre valores fora da tabela, reclamações, cobranças ou reembolsos, mudanças de dados fiscais, problemas técnicos da app que não consegue resolver, ou quando o utilizador pedir uma pessoa.
Para encaminhar, escreva uma mensagem curta a dizer que o gestor será contactado e termine a resposta com a tag ${AI_ESCALATION_TAG} (sem mais texto depois dela).`;

  async function askGemini(
    turns: Array<{ role: 'user' | 'model'; text: string }>,
    system: string
  ): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw Object.assign(new Error('Assistente IA não configurado (GEMINI_API_KEY).'), { status: 503 });
    }
    const baseUrl = process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com';
    const resp = await fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
        }),
      }
    );
    if (!resp.ok) {
      if (resp.status === 429) {
        throw Object.assign(new Error('Muitos pedidos ao assistente. Tente de novo daqui a instantes.'), { status: 429 });
      }
      console.error('Gemini error', resp.status);
      throw Object.assign(new Error('O assistente está indisponível de momento. Tente mais tarde.'), { status: 502 });
    }
    const data: any = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim();
    if (!text) throw Object.assign(new Error('O assistente não devolveu resposta.'), { status: 502 });
    return text;
  }

  app.get('/api/ai/status', requireAuth(), (_req, res) => {
    res.json({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()), model: GEMINI_MODEL });
  });

  app.post('/api/ai/chat', requireAuth(), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Escreva uma mensagem.' });
    if (message.length > 2000) return res.status(400).json({ error: 'Mensagem demasiado longa (máximo 2000 caracteres).' });

    const requestedId = String(req.body?.conversationId || '');
    let conv = requestedId
      ? (db.prepare("SELECT * FROM ai_conversations WHERE id = ? AND user_id = ? AND status != 'closed'").get(requestedId, user.id) as any)
      : null;
    if (!conv) {
      const id = `aic-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare('INSERT INTO ai_conversations (id, user_id) VALUES (?, ?)').run(id, user.id);
      conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
    }

    const saveMessage = (sender: string, content: string) => {
      db.prepare('INSERT INTO ai_messages (id, conversation_id, sender, content) VALUES (?, ?, ?, ?)').run(
        `aim-${crypto.randomUUID().slice(0, 8)}`,
        conv.id,
        sender,
        content
      );
    };

    saveMessage('customer', message);

    // Conversa já encaminhada: o gestor responde, a IA não
    if (conv.status === 'escalated') {
      saveMessage('ai', AI_ESCALATION_REPLY);
      db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
      return res.json({ conversationId: conv.id, response: AI_ESCALATION_REPLY, escalated: true });
    }

    const history = db
      // rowid (e não created_at, que tem resolução de segundo) mantém a ordem exata das mensagens
      .prepare('SELECT sender, content FROM ai_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 20')
      .all(conv.id) as Array<{ sender: string; content: string }>;
    const turns = history
      .reverse()
      .map((m) => ({ role: (m.sender === 'customer' ? 'user' : 'model') as 'user' | 'model', text: m.content }));

    try {
      const raw = await askGemini(turns, aiSystemPrompt(user.role));
      const escalated = raw.includes(AI_ESCALATION_TAG);
      const response = raw.replace(AI_ESCALATION_TAG, '').trim() || AI_ESCALATION_REPLY;
      saveMessage('ai', response);
      if (escalated) {
        db.prepare("UPDATE ai_conversations SET status = 'escalated', updated_at = datetime('now') WHERE id = ?").run(conv.id);
        const admins = db.prepare("SELECT id FROM profiles WHERE role = 'super_admin' AND is_active = 1").all() as any[];
        for (const a of admins) {
          createNotification(
            a.id,
            'Assistente IA: conversa encaminhada',
            `${user.full_name || 'Um utilizador'} precisa de atendimento humano. Veja em Central de Chat.`,
            'in_app'
          );
        }
      }
      db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
      return res.json({ conversationId: conv.id, response, escalated });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      return res.status(status).json({ error: err?.message || 'Erro no assistente.', conversationId: conv.id });
    }
  });

  // Conversas encaminhadas pela IA para o gestor
  app.get('/api/ai/escalations', requireAuth(['super_admin']), (_req, res) => {
    const rows = db
      .prepare(`
        SELECT c.id, c.status, c.updated_at, p.full_name AS customer_name, p.role AS customer_role
        FROM ai_conversations c
        JOIN profiles p ON p.id = c.user_id
        WHERE c.status = 'escalated'
        ORDER BY c.updated_at DESC
      `)
      .all() as any[];
    const escalations = rows.map((r) => ({
      ...r,
      messages: (db
        .prepare('SELECT sender, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 8')
        .all(r.id) as any[]).reverse(),
    }));
    res.json({ escalations });
  });

  app.post('/api/ai/conversations/:id/resolve', requireAuth(['super_admin']), (req, res) => {
    const result = db
      .prepare("UPDATE ai_conversations SET status = 'closed', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ ok: true });
  });
}
