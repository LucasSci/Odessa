import handler from '../../[...path].js';

export default function chatAutomationValidate(req, res) {
  req.query = { ...req.query, path: ['v1', 'chat-automation', 'validate'] };
  return handler(req, res);
}
