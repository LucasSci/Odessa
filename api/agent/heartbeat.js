import handler from '../[...path].js';

export default function agentHeartbeat(req, res) {
  req.query = { ...req.query, path: ['agent', 'heartbeat'] };
  return handler(req, res);
}
