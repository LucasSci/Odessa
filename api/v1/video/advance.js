import handler from '../../[...path].js';

export default function videoAdvance(req, res) {
  req.query = { ...req.query, path: ['v1', 'video', 'advance'] };
  return handler(req, res);
}
