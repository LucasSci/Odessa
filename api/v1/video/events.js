// Aviso de mudança do palco (SSE) — só existe no servidor local (FastAPI).
//
// Função serverless não segura uma conexão aberta, então aqui não há fluxo de
// eventos. Responder 204 encerra o EventSource sem reconexão (especificação do
// SSE); sem esta rota ele ficava tentando de novo a cada poucos segundos. O
// overlay e a Central continuam na consulta de /video/state, como antes.
export default function videoEvents(_req, res) {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
