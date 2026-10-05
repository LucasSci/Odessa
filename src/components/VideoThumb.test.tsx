import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { videoIdFromSrc } from '../lib/videoPoster';
import { VideoThumb } from './VideoThumb';

describe('VideoThumb', () => {
  it('mostra a miniatura JPEG, sem abrir o vídeo', () => {
    const { container } = render(<VideoThumb src="/api/video/play/clip_1" label="Clip 1" />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/video\/thumb\/clip_1$/);
    expect(container.querySelector('video')).toBeNull();
  });

  it('com prévia, abre o vídeo só enquanto o mouse está em cima', () => {
    const { container, getByRole } = render(<VideoThumb src="/api/video/play/clip_1" label="Clip 1" previewOnHover />);
    fireEvent.pointerEnter(getByRole('img', { name: 'Clip 1' }));
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/video/play/clip_1');
    fireEvent.pointerLeave(getByRole('img', { name: 'Clip 1' }));
    expect(container.querySelector('video')).toBeNull();
  });

  it('usa o id informado quando a URL não é de /video/play', () => {
    const { container } = render(<VideoThumb src="blob:abc" videoId="deck 2" label="Deck" />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/thumb\/deck%202$/);
  });
});

describe('videoIdFromSrc', () => {
  it('tira o id da URL de reprodução', () => {
    expect(videoIdFromSrc('http://127.0.0.1:8000/api/v1/video/play/46_FLUXO_A0?x=1')).toBe('46_FLUXO_A0');
    expect(videoIdFromSrc('/outra/coisa.mp4')).toBeNull();
  });
});
