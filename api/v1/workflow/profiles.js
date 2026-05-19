import { json, getSession, readBody, loadProfiles, saveProfiles, getKvValue, setKvValue, newId } from '../../_lib/profile-store.js';

const PERSONA_CONFIG_KEY = 'persona_config';

export default async function workflowProfiles(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { detail: 'Nao autenticado.' });

  if (req.method === 'GET') {
    return json(res, 200, { ok: true, profiles: loadProfiles('workflow') });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { ok: false, detail: 'Nome do perfil e obrigatorio.' });

    const profiles = loadProfiles('workflow');
    const config = getKvValue(PERSONA_CONFIG_KEY) || {};
    const snapshot = (body.workflow && typeof body.workflow === 'object') ? body.workflow : {
      flowNodes: config.flowNodes || [],
      flowConnections: config.flowConnections || [],
      triggers: config.triggers || [],
      idleVideoId: config.idleVideoId || null,
      videos: config.videos || [],
      giftMap: config.giftMap || config.gift_map || {},
      transitions: config.transitions || [],
      workflowName: name,
    };
    const existing = profiles.findIndex((p) => p.id === body.id || p.name === name);
    const profile = {
      id: existing >= 0 ? profiles[existing].id : newId(),
      name,
      workflow: snapshot,
      createdAt: existing >= 0 ? profiles[existing].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) profiles[existing] = profile;
    else profiles.push(profile);
    saveProfiles('workflow', profiles);
    return json(res, 200, { ok: true, profile, profiles });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    const profiles = loadProfiles('workflow').filter((p) => p.id !== body.id);
    saveProfiles('workflow', profiles);
    return json(res, 200, { ok: true, profiles });
  }

  return json(res, 405, { detail: 'Method not allowed' });
}
