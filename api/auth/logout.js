import handler from '../[...path].js';

export default function authLogout(req, res) {
  req.query = { ...req.query, path: ['auth', 'logout'] };
  return handler(req, res);
}
