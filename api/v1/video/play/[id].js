import handler from '../../../[...path].js';

export default function videoPlay(req, res) {
  req.query = { ...req.query, path: ['v1', 'video', 'play', req.query.id] };
  return handler(req, res);
}
