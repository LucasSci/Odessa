import { json, getSession, readBody, loadProfiles, getKvValue, setKvValue } from '../../../_lib/profile-store.js';

const PERSONA_CONFIG_KEY = 'persona_config';

export default async function workflowProfilesApply(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { detail: 'Nao autenticado.' });
  if (req.method !== 'POST') return json(res, 405, { detail: 'Method not allowed' });

  const body = await readBody(req);
  const profiles = loadProfiles('workflow');
  const profile = profiles.find((p) => p.id === body.id);
  if (!profile) return json(res, 404, { ok: false, detail: 'Perfil nao encontrado.' });

  const config = getKvValue(PERSONA_CONFIG_KEY) || {};
  const w = profile.workflow || {};
  if (Array.isArray(w.videos)) config.videos = w.videos;
  if (Array.isArray(w.triggers)) config.triggers = w.triggers;
  if (Array.isArray(w.flowNodes)) config.flowNodes = w.flowNodes;
  if (Array.isArray(w.flowConnections)) config.flowConnections = w.flowConnections;
  if (w.idleVideoId !== undefined) config.idleVideoId = w.idleVideoId;
  if (w.giftMap) config.giftMap = w.giftMap;
  if (w.gift_map) config.gift_map = w.gift_map;
  if (w.transitions) config.transitions = w.transitions;
  config.draftWorkflow = w;
  config.updatedAt = new Date().toISOString();
  setKvValue(PERSONA_CONFIG_KEY, config);

  // Auto-start idle video so the profile takes effect immediately
  const idleVideoId = w.idleVideoId || config.idleVideoId || null;
  if (idleVideoId) {
    const flowNodes = w.flowNodes || config.flowNodes || [];
    const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
    const pb = idleNode?.playback || {};
    setKvValue('video_state', {
      activeNodeId: idleNode?.nodeId || null,
      currentClip: {
        nodeId: idleNode?.nodeId || null,
        videoId: idleVideoId,
        startSec: pb.startSec || 0,
        endSec: pb.endSec || null,
        transitionMs: pb.transitionMs || 220,
        loop: true,
        returnToIdle: false,
        audio: idleNode?.audio || { mode: 'muted', volume: 1 },
      },
      current_video_id: idleVideoId,
      updatedAt: new Date().toISOString(),
    });
  }

  return json(res, 200, { ok: true, appliedProfile: profile.name, updatedAt: config.updatedAt });
}
