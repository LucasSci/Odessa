import handler from '../../../[...path].js';

export default function conversationReply(req, res) {
  req.query = { ...req.query, path: ['v1', 'conversations', req.query.id, 'reply'] };
  return handler(req, res);
}
