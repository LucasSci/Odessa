import handler from '../../[...path].js';

export default function chatAutomationConfig(req, res) {
  req.query = { ...req.query, path: ['v1', 'chat-automation', 'config'] };
  return handler(req, res);
}
