import handler from '../../[...path].js';

export default function workflowDraft(req, res) {
  req.query = { ...req.query, path: ['v1', 'workflow', 'draft'] };
  return handler(req, res);
}
