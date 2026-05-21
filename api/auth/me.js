import handler from '../[...path].js';

export default function authMe(req, res) {
  req.query = { ...req.query, path: ['auth', 'me'] };
  return handler(req, res);
}
