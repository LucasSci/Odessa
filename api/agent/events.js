import handler from '../[...path].js';

export default function agentEvents(req, res) {
  req.query = { ...req.query, path: ['agent', 'events'] };
  return handler(req, res);
}
