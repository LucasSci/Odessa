import handler from '../[...path].js';

export default function authLogin(req, res) {
  req.query = { ...req.query, path: ['auth', 'login'] };
  return handler(req, res);
}
