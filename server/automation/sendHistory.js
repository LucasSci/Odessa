// server/automation/sendHistory.js
// Camada de Persistência: relatório de histórico de envios com mock de banco de dados.

const sendHistoryStore = new Map();

export function createSendIntent({ conversationId, description, metadata = {} }) {
  const id = `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    conversationId: conversationId || null,
    description: description || 'Envio de mensagem automatizada',
    metadata,
    status: 'Pendente',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [],
  };
  sendHistoryStore.set(id, record);
  return record;
}

export function updateSendStatus(id, status, details = {}) {
  const record = sendHistoryStore.get(id);
  if (!record) {
    throw new Error(`Registro de envio não encontrado para id=${id}`);
  }
  record.status = status;
  record.updatedAt = new Date().toISOString();
  if (details.message) {
    record.log.push({ timestamp: new Date().toISOString(), message: details.message });
  }
  if (details.error) {
    record.log.push({ timestamp: new Date().toISOString(), error: details.error });
  }
  if (details.result) {
    record.result = details.result;
  }
  sendHistoryStore.set(id, record);
  return record;
}

export function getSendHistory(id) {
  return sendHistoryStore.get(id) || null;
}

export function listSendHistory() {
  return Array.from(sendHistoryStore.values()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
