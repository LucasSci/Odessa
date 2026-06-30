import handler from '../../../[...path].js';

export default function conversationMessages(req, res) {
  req.query = { ...req.query, path: ['v1', 'conversations', req.query.id, 'messages'] };
  return handler(req, res);
}
