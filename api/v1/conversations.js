import handler from '../[...path].js';

export default function conversations(req, res) {
  req.query = { ...req.query, path: ['v1', 'conversations'] };
  return handler(req, res);
}
