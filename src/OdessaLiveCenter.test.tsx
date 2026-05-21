import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContinuityPlayer } from './OdessaLiveCenter';

const videos = [
  { id: 'idle-loop', label: 'Idle loop', loop: true },
  { id: 'rosa-video', label: 'Rosa reaction' },
];

const idleClip = {
  videoId: 'idle-loop',
  label: 'Idle loop',
  startSec: 0,
  endSec: null,
  transitionMs: 120,
  returnToIdle: false,
};

const rosaClip = {
  videoId: 'rosa-video',
  label: 'Rosa reaction',
  startSec: 0,
  endSec: 4,
  transitionMs: 120,
  returnToIdle: true,
};

async function flushPlayerTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(80);
  });
}

describe('ContinuityPlayer', () => {
  let playSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined) as unknown as ReturnType<
      typeof vi.fn
    >;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays the initial clip', async () => {
    render(<ContinuityPlayer clip={idleClip} videos={videos} onEnded={async () => undefined} />);

    await flushPlayerTimers();

    expect(playSpy).toHaveBeenCalled();
  });

  it('plays again when the active clip changes', async () => {
    const { rerender } = render(
      <ContinuityPlayer clip={idleClip} videos={videos} onEnded={async () => undefined} />,
    );
    await flushPlayerTimers();
    playSpy.mockClear();

    rerender(<ContinuityPlayer clip={rosaClip} videos={videos} onEnded={async () => undefined} />);
    await flushPlayerTimers();

    expect(playSpy).toHaveBeenCalled();
  });

  it('watchdog retries play when the active video is paused', async () => {
    render(<ContinuityPlayer clip={idleClip} videos={videos} onEnded={async () => undefined} />);
    await flushPlayerTimers();
    playSpy.mockClear();

    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(playSpy).toHaveBeenCalled();
  });
});
