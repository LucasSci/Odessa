import handler from '../../[...path].js';

export default function chatAutomationSend(req, res) {
  req.query = { ...req.query, path: ['v1', 'chat-automation', 'send'] };
  return handler(req, res);
}
