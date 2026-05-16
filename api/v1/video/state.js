import handler from '../../[...path].js';

export default function videoState(req, res) {
  req.query = { ...req.query, path: ['v1', 'video', 'state'] };
  return handler(req, res);
}
