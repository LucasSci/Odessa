import handler from '../../[...path].js';

export default function automationLogs(req, res) {
  req.query = { ...req.query, path: ['v1', 'automation', 'logs'] };
  return handler(req, res);
}
