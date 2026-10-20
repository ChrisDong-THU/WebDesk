export type PointerSample = Pick<MouseEvent,
  'target' | 'button' | 'buttons' | 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>;

/** Own a drag until its matching release, even outside the video element. */
export function bindPointerInput(options: {
  area: EventTarget;
  window: EventTarget;
  video: () => HTMLVideoElement | undefined;
  active: () => boolean;
  down: (event: PointerSample) => void;
  move: (event: PointerSample) => void;
  up: (event: PointerSample) => void;
  cancel: () => void;
  congested?: () => boolean;
}) {
  const pressed = new Set<number>();
  const masks = [1, 4, 2]; // MouseEvent.button order: left, middle, right.
  let pending: PointerSample | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; pending = undefined; };
  const flush = () => {
    const event = pending;
    clear();
    if (event && options.active()) options.move(event);
  };
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!options.active()) { clear(); return; }
      if (options.congested?.()) { schedule(); return; }
      flush();
    }, 16);
  };
  const removers: Array<() => void> = [];
  const bind = <K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget, type: K, callback: (event: GlobalEventHandlersEventMap[K]) => void,
  ) => {
    target.addEventListener(type, callback as EventListener, true);
    removers.push(() => target.removeEventListener(type, callback as EventListener, true));
  };
  const reset = () => { pressed.clear(); clear(); };
  const cancel = () => { const held = pressed.size > 0; reset(); if (held) options.cancel(); };
  const relative = (event: MouseEvent, video: HTMLVideoElement): PointerSample => {
    const rect = video.getBoundingClientRect();
    // Keep the video origin when a drag event targets an element outside it.
    return {
      target: video, button: event.button, buttons: event.buttons,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      clientX: Math.max(rect.left, Math.min(rect.right, event.clientX)),
      clientY: Math.max(rect.top, Math.min(rect.bottom, event.clientY)),
    };
  };
  bind(options.area, 'mousedown', (event: MouseEvent) => {
    const video = options.video();
    if (!options.active() || !video || event.target !== video) return;
    if (!Number.isInteger(event.button) || event.button < 0 || event.button > 2) return;
    event.preventDefault?.();
    // Focusing must not scroll the page between reading the event's position
    // and converting it to video coordinates.
    video.focus({ preventScroll: true });
    if (pressed.has(event.button)) return;
    flush();
    pressed.add(event.button);
    options.down(relative(event, video));
  });
  bind(options.window, 'mousemove', (event: MouseEvent) => {
    const video = options.video();
    if (!options.active() || !video) return;
    if ([...pressed].some(button => !(event.buttons & masks[button]))) cancel();
    if (pressed.size || event.target === video) {
      pending = relative(event, video);
      schedule();
    }
  });
  bind(options.window, 'mouseup', (event: MouseEvent) => {
    if (!pressed.has(event.button)) return;
    flush();
    pressed.delete(event.button);
    const video = options.video();
    if (options.active() && video) options.up(relative(event, video));
  });
  bind(options.window, 'pointercancel', cancel);
  bind(options.window, 'blur', cancel);
  bind(options.area, 'focusout', cancel);
  return { reset, flush, dispose: () => { reset(); removers.forEach(remove => remove()); } };
}
