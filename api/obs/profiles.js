import { json, getSession, readBody, loadProfiles, saveProfiles, getKvValue, newId } from '../_lib/profile-store.js';

const OBS_SETTINGS_KEY = 'obs_settings';

export default async function obsProfiles(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { detail: 'Nao autenticado.' });

  if (req.method === 'GET') {
    return json(res, 200, { ok: true, profiles: loadProfiles('obs') });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { ok: false, detail: 'Nome do perfil e obrigatorio.' });

    const profiles = loadProfiles('obs');
    const settings = body.settings || getKvValue(OBS_SETTINGS_KEY) || {};
    const existing = profiles.findIndex((p) => p.id === body.id || p.name === name);
    const profile = {
      id: existing >= 0 ? profiles[existing].id : newId(),
      name,
      settings,
      createdAt: existing >= 0 ? profiles[existing].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) profiles[existing] = profile;
    else profiles.push(profile);
    saveProfiles('obs', profiles);
    return json(res, 200, { ok: true, profile, profiles });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    const profiles = loadProfiles('obs').filter((p) => p.id !== body.id);
    saveProfiles('obs', profiles);
    return json(res, 200, { ok: true, profiles });
  }

  return json(res, 405, { detail: 'Method not allowed' });
}
