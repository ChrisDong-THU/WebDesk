/** Own a drag until its matching release, even outside the video element. */
export function bindPointerInput(options: {
  area: EventTarget;
  window: EventTarget;
  video: () => HTMLVideoElement | undefined;
  active: () => boolean;
  down: (event: MouseEvent) => void;
  move: (event: MouseEvent) => void;
  up: (event: MouseEvent) => void;
  cancel: () => void;
  congested?: () => boolean;
}) {
  let pressed = false;
  let pending: MouseEvent | undefined;
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
  const bind = (target: EventTarget, type: string, callback: (event: any) => void) => {
    target.addEventListener(type, callback, true);
    removers.push(() => target.removeEventListener(type, callback, true));
  };
  const reset = () => { pressed = false; clear(); };
  const cancel = () => { if (pressed) { reset(); options.cancel(); } };
  const relative = (event: MouseEvent, video: HTMLVideoElement): MouseEvent => {
    const rect = video.getBoundingClientRect();
    // Upstream reads target bounds, not currentTarget. Keep the same origin
    // when the actual event target is another element outside the picture.
    return {
      target: video, button: event.button, buttons: event.buttons,
      clientX: Math.max(rect.left, Math.min(rect.right, event.clientX)),
      clientY: Math.max(rect.top, Math.min(rect.bottom, event.clientY)),
    } as unknown as MouseEvent;
  };
  bind(options.area, 'mousedown', (event: MouseEvent) => {
    const video = options.video();
    if (!options.active() || !video || event.target !== video) return;
    video.focus();
    if (event.button !== 0) return;
    flush();
    pressed = true;
    options.down(relative(event, video));
  });
  bind(options.window, 'mousemove', (event: MouseEvent) => {
    const video = options.video();
    if (!options.active() || !video) return;
    if (pressed && !(event.buttons & 1)) cancel();
    if (pressed || event.target === video) {
      pending = relative(event, video);
      schedule();
    }
  });
  bind(options.window, 'mouseup', (event: MouseEvent) => {
    if (!pressed || event.button !== 0) return;
    flush();
    reset();
    const video = options.video();
    if (options.active() && video) options.up(relative(event, video));
  });
  bind(options.window, 'pointercancel', cancel);
  bind(options.window, 'blur', cancel);
  bind(options.area, 'focusout', cancel);
  return { reset, flush, dispose: () => { reset(); removers.forEach(remove => remove()); } };
}
