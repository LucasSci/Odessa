import handler from '../[...path].js';

export default function agentStatus(req, res) {
  req.query = { ...req.query, path: ['agent', 'status'] };
  return handler(req, res);
}
