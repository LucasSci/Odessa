import handler from '../../[...path].js';

export default function chatAutomationBridge(req, res) {
  req.query = { ...req.query, path: ['v1', 'chat-automation', 'bridge'] };
  return handler(req, res);
}
