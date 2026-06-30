import handler from '../../[...path].js';

export default function conversationById(req, res) {
  req.query = { ...req.query, path: ['v1', 'conversations', req.query.id] };
  return handler(req, res);
}
