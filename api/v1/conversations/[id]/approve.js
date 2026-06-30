import handler from '../../../[...path].js';

export default function conversationApprove(req, res) {
  req.query = { ...req.query, path: ['v1', 'conversations', req.query.id, 'approve'] };
  return handler(req, res);
}
