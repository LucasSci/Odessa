import handler from '../../[...path].js';

export default function videoForce(req, res) {
  req.query = { ...req.query, path: ['v1', 'video', 'force'] };
  return handler(req, res);
}
