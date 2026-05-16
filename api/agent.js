import handler from './[...path].js';

export default function agent(req, res) {
  req.query = { ...req.query, path: ['agent'] };
  return handler(req, res);
}
