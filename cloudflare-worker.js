/**
 * Odessa — Ponte Gemini (Cloudflare Worker)
 * ─────────────────────────────────────────
 * O navegador NÃO consegue chamar a Gemini direto: o endpoint do Google não
 * responde o preflight CORS, então toda chamada vira "Failed to fetch". Este
 * Worker roda na nuvem da Cloudflare (grátis), recebe { key, model, payload }
 * do site e encaminha para a Gemini, devolvendo a resposta com CORS liberado.
 *
 * Como usar:
 *  1. Crie uma conta grátis em https://dash.cloudflare.com
 *  2. Workers & Pages → Create → Worker → dê um nome (ex.: odessa-gemini) → Deploy
 *  3. Edit code → apague tudo → cole ESTE arquivo → Deploy
 *  4. Copie a URL que aparece (ex.: https://odessa-gemini.SEU-USER.workers.dev)
 *  5. No site Odessa → aba IA → campo "Ponte da IA" → cole a URL → Salvar
 *
 * A chave da Gemini NUNCA fica guardada no Worker — ela só passa por ele a cada
 * chamada. Se quiser, troque ALLOW_ORIGIN pelo domínio do seu site para travar
 * o uso só ao seu site.
 */

const ALLOW_ORIGIN = '*'; // ou: 'https://darkgrey-shark-457698.hostingersite.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Use POST.' }, 405);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Corpo JSON inválido.' }, 400);
    }
    const key = String(body && body.key || '').trim();
    if (!key) return json({ error: 'key (chave Gemini) ausente.' }, 400);
    const model = String(body && body.model || 'gemini-2.0-flash').trim();
    const payload = (body && body.payload) || {};
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      return json({ error: 'Ponte falhou: ' + (err && err.message ? err.message : String(err)) }, 502);
    }
  },
};
