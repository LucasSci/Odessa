import handler from '../../[...path].js';

export default function videoConfig(req, res) {
  req.query = { ...req.query, path: ['v1', 'video', 'config'] };
  return handler(req, res);
}
