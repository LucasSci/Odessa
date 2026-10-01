import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudioItemState, StudioVideo } from '../../core/idleStudioApi';
import { StudioItemCard } from './StudioItemCard';

const video: StudioVideo = {
  file: '74_GATILHO_A0_beijo',
  number: 74,
  category: 'GATILHO',
  categoryLabel: 'Gatilho',
  start: 'A0',
  end: 'A0',
  lote: 0,
  pingpong: false,
  event: 'presente pequeno',
  duration: '3 s',
  firstFrame: 'A0_camera.png',
  lastFrame: 'A0_camera.png',
  prompt: 'SCENE LOCK beijo',
};

const asset = (id: string, name: string, originalName: string, type = 'image/jpeg') => ({
  id,
  name,
  originalName,
  type,
  at: '',
  source: 'upload',
  url: `/api/v1/idle-studio/viktoria/assets/${id}`,
});

function renderCard(state: StudioItemState, states: Record<string, StudioItemState> = {}) {
  const handlers = { onUpload: vi.fn(), onStatus: vi.fn(), onChoose: vi.fn(), onRemove: vi.fn(), onGenerate: vi.fn() };
  render(
    <StudioItemCard
      entry={{ kind: 'video', key: video.file, video }}
      state={state}
      states={states}
      negative="blur"
      generateReady={false}
      generateHint="Configure um provedor de vídeo"
      {...handlers}
    />,
  );
  return handlers;
}

describe('StudioItemCard', () => {
  it('mostra o 1º/último frame aprovado com o nome da etapa e os botões de copiar e baixar', () => {
    const frame = { status: 'aprovado' as const, chosen: 'a1', assets: [asset('a1', 'A0_camera.jpg', 'Woman_2K.jpg')] };
    renderCard({ status: 'pendente', assets: [], chosen: null }, { 'A0_camera.png': frame });
    expect(screen.getByText('1º e último frame')).toBeTruthy();
    expect(screen.getByText('A0_camera.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copiar$/ })).toBeTruthy();
    const download = screen.getByRole('link', { name: /Baixar/ });
    expect(download.getAttribute('download')).toBe('A0_camera.jpg');
    expect(download.getAttribute('href')).toContain('download=true');
  });

  it('não deixa aprovar sem anexo e deixa o gerar por API desligado sem provedor', () => {
    const { onStatus } = renderCard({ status: 'pendente', assets: [], chosen: null });
    expect((screen.getByRole('button', { name: 'Aprovar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Gerar por API/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer' }));
    expect(onStatus).toHaveBeenCalledWith(video.file, 'refazer');
  });

  it('o anexo aparece com o nome automático e o original embaixo; escolher outro avisa a página', () => {
    const state: StudioItemState = {
      status: 'gerado',
      chosen: 'v1',
      assets: [
        asset('v1', '74_GATILHO_A0_beijo.mp4', 'kling_0001.mp4', 'video/mp4'),
        asset('v2', '74_GATILHO_A0_beijo_v2.mp4', 'kling_0002.mp4', 'video/mp4'),
      ],
    };
    const { onChoose } = renderCard(state);
    expect(screen.getByTitle('74_GATILHO_A0_beijo.mp4').tagName).toBe('CODE');
    expect(screen.getByText('era kling_0002.mp4')).toBeTruthy();
    // Vídeo: só baixar/abrir, sem copiar imagem.
    expect(screen.queryByRole('button', { name: /^Copiar$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher' }));
    expect(onChoose).toHaveBeenCalledWith(video.file, 'v2');
  });
});
