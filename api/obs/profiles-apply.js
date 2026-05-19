import { json, getSession, readBody, loadProfiles, setKvValue } from '../_lib/profile-store.js';

const OBS_SETTINGS_KEY = 'obs_settings';

export default async function obsProfilesApply(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { detail: 'Nao autenticado.' });
  if (req.method !== 'POST') return json(res, 405, { detail: 'Method not allowed' });

  const body = await readBody(req);
  const profiles = loadProfiles('obs');
  const profile = profiles.find((p) => p.id === body.id);
  if (!profile) return json(res, 404, { ok: false, detail: 'Perfil nao encontrado.' });

  const settings = profile.settings || {};
  setKvValue(OBS_SETTINGS_KEY, settings);

  return json(res, 200, { ok: true, settings, appliedProfile: profile.name });
}
