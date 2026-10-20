import { bindPointerInput, type PointerSample } from './pointer';
import { createKeyboardInput } from './keyboard';
import { createWheelNormalizer } from './wheel';

type Behavior = { type: number; key?: number[]; x?: number; y?: number; amount?: number };

/** One path for physical input. Click/dblclick/contextmenu never inject clicks. */
export function bindControllerInput(options: {
  area: EventTarget; window: EventTarget;
  document: EventTarget & Pick<Document, 'hidden' | 'fullscreenElement' | 'exitFullscreen'>;
  video: () => HTMLVideoElement | undefined; active: () => boolean;
  focused: () => boolean; congested: () => boolean; send: (data: Behavior) => void;
}) {
  const removers: Array<() => void> = [];
  const bind = <K extends keyof DocumentEventMap>(
    target: EventTarget, type: K, handler: (event: DocumentEventMap[K]) => void,
  ) => {
    target.addEventListener(type, handler as EventListener, { passive: false });
    removers.push(() => target.removeEventListener(type, handler as EventListener));
  };
  let dirty = false;
  const send = (data: Behavior) => { dirty = true; options.send(data); };
  const keyboard = createKeyboardInput(send);
  const wheel = createWheelNormalizer();
  const position = (event: PointerSample) => {
    const rect = options.video()?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return undefined;
    return { x: Math.max(0, Math.min(1000, (event.clientX - rect.left) * 1000 / rect.width)),
      y: Math.max(0, Math.min(1000, (event.clientY - rect.top) * 1000 / rect.height)) };
  };
  const move = (event: PointerSample) => {
    const point = position(event);
    if (point) send({ type: 0, ...point });
    return !!point;
  };
  const button = (event: PointerSample, up: boolean) => {
    // Position is ordered before every edge, even without a preceding move.
    if (!move(event)) return;
    keyboard.syncModifiers(event);
    send({ type: (up ? [4, 19, 5] : [2, 18, 3])[event.button] });
  };
  const reset = () => { pointer.reset(); keyboard.reset(); wheel.reset(); dirty = false; };
  const release = () => {
    const needsRelease = dirty;
    reset();
    if (needsRelease && options.active()) options.send({ type: 17 });
  };
  const pointer = bindPointerInput({
    ...options, down: event => button(event, false), move,
    up: event => button(event, true), cancel: release,
  });
  const onVideo = (event: MouseEvent) => options.active() && event.target === options.video();
  for (const type of ['click', 'dblclick', 'contextmenu', 'auxclick', 'dragstart'] as const) {
    bind(options.area, type, (event: MouseEvent) => { if (onVideo(event)) event.preventDefault(); });
  }
  bind(options.area, 'wheel', (event: WheelEvent) => {
    if (!onVideo(event)) return;
    event.preventDefault();
    pointer.flush();
    if (!move(event)) return;
    keyboard.syncModifiers(event);
    const delta = wheel.normalize(event);
    if (delta.deltaY) send({ type: delta.deltaY > 0 ? 10 : 11, amount: Math.abs(delta.deltaY) });
    if (delta.deltaX) send({ type: delta.deltaX > 0 ? 13 : 12, amount: Math.abs(delta.deltaX) });
  });
  const fullscreen = () => {
    const video = options.video();
    return !!video && !!options.document.fullscreenElement?.contains(video);
  };
  let wasFullscreen = fullscreen();
  let localEscape = false;
  const releaseFocus = () => { release(); options.video()?.blur(); };
  // Browsers may consume Escape before dispatching keydown to the page.
  bind(options.document, 'fullscreenchange', () => {
    const current = fullscreen();
    if (wasFullscreen && !current) {
      localEscape = true;
      releaseFocus();
    }
    wasFullscreen = current;
  });
  for (const type of ['keydown', 'keyup'] as const) {
    bind(options.window, type, (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        // A new physical press outside fullscreen is an ordinary remote key.
        if (type === 'keydown' && !event.repeat) localEscape = false;
        if (options.active() && fullscreen()) {
          localEscape = true;
          releaseFocus();
          void options.document.exitFullscreen().catch(() => {});
        }
        if (localEscape) {
          event.preventDefault();
          if (type === 'keyup') localEscape = false;
          return;
        }
      }
      if (!options.active() || !options.focused()) return;
      pointer.flush();
      keyboard[type === 'keydown' ? 'down' : 'up'](event);
    });
  }
  bind(options.area, 'focusout', release);
  bind(options.window, 'blur', release);
  bind(options.document, 'visibilitychange', () => { if (options.document.hidden) release(); });
  return { reset, release, dispose: () => { reset(); pointer.dispose(); removers.forEach(remove => remove()); } };
}
