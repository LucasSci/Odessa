import handler from '../../[...path].js';

export default function chatAutomationWebSend(req, res) {
  req.query = { ...req.query, path: ['v1', 'chat-automation', 'web-send'] };
  return handler(req, res);
}
