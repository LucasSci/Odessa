import handler from '../../[...path].js';

export default function agentCommandsNext(req, res) {
  req.query = { ...req.query, path: ['agent', 'commands', 'next'] };
  return handler(req, res);
}
