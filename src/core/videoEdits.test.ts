import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyVideoEdit,
  defaultVideoEdit,
  getVideoEdit,
  hasVideoEdit,
  loadVideoEdits,
  removeVideoEdit,
  saveVideoEdit,
  type EditableClip,
} from './videoEdits';

const STORAGE_KEY = 'odessa:video-edits:v1';

function clip(videoId = 'v1'): EditableClip {
  return { videoId, startSec: 0, endSec: null, transitionMs: 100 };
}

describe('videoEdits', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('retorna null e mantém o clipe intacto quando não há edição salva', () => {
    const c = clip();
    expect(getVideoEdit('v1')).toBeNull();
    expect(hasVideoEdit('v1')).toBe(false);
    expect(applyVideoEdit(c)).toBe(c);
  });

  it('salva e relê uma edição normalizada', () => {
    saveVideoEdit({ ...defaultVideoEdit('v1'), volume: 5, transitionMs: 99999, audioMode: 'original' });
    const e = getVideoEdit('v1');
    expect(e?.volume).toBe(1);
    expect(e?.transitionMs).toBe(4000);
    expect(e?.audioMode).toBe('original');
    expect(hasVideoEdit('v1')).toBe(true);
  });

  it('descarta segmentos inválidos e preserva a ordem de reprodução', () => {
    saveVideoEdit({
      ...defaultVideoEdit('v1'),
      segments: [
        { startSec: 8, endSec: 10 },
        { startSec: 5, endSec: 5 },
        { startSec: 1, endSec: 3 },
      ],
    });
    expect(getVideoEdit('v1')?.segments).toEqual([
      { startSec: 8, endSec: 10 },
      { startSec: 1, endSec: 3 },
    ]);
  });

  it('usa o min/max real dos segmentos como início/fim do clipe (ordem livre)', () => {
    saveVideoEdit({
      ...defaultVideoEdit('v1'),
      segments: [
        { startSec: 8, endSec: 10 },
        { startSec: 1, endSec: 3 },
      ],
    });
    const out = applyVideoEdit(clip());
    expect(out.startSec).toBe(1);
    expect(out.endSec).toBe(10);
    expect(out.segments).toHaveLength(2);
    expect(out.audio?.mode).toBe('muted');
  });

  it('remove a edição', () => {
    saveVideoEdit({ ...defaultVideoEdit('v1'), volume: 0.5 });
    removeVideoEdit('v1');
    expect(getVideoEdit('v1')).toBeNull();
  });

  it('ignora JSON corrompido no storage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{nao-e-json');
    expect(loadVideoEdits()).toEqual({});
    expect(getVideoEdit('v1')).toBeNull();
  });
});
