const HOLD_DELAY = 500;
const MOVE_TOLERANCE = 10;

function isTouchInput(event) {
  const original = event?.originalEvent || event;
  return original?.pointerType === 'touch' || original?.pointerType === 'pen' ||
    original?.type?.startsWith('touch') || original?.sourceCapabilities?.firesTouchEvents;
}

/** Show a visited place's name while a finger is held still, without blocking map gestures. */
export function bindLongPress(map, { resolve, show, hide }) {
  const container = map.getContainer?.();
  const doc = container?.ownerDocument;
  const view = doc?.defaultView;
  let pending = null;
  let timer = null;
  let ignoreMouseUntil = 0;
  const pointers = new Set();
  const listeners = [];
  const shouldIgnoreHover = event => Boolean(isTouchInput(event) || pointers.size || Date.now() < ignoreMouseUntil);
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
    hide();
  };
  if (!container?.addEventListener || !doc) return { cancel, destroy: cancel, shouldIgnoreHover };

  const listen = (target, type, handler, options = { capture: true, passive: true }) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const touched = () => { ignoreMouseUntil = Date.now() + 800; };
  const begin = (point, target, id) => {
    cancel();
    if (target?.closest?.('.leaflet-control')) return;
    const latlng = map.mouseEventToLatLng(point);
    if (!resolve(latlng)) return;
    pending = { id, x: point.clientX, y: point.clientY, latlng };
    timer = setTimeout(() => {
      timer = null;
      if (!pending) return;
      const place = resolve(pending.latlng);
      if (place) show(place, pending.latlng);
    }, HOLD_DELAY);
  };
  const move = point => {
    touched();
    if (pending && Math.hypot(point.clientX - pending.x, point.clientY - pending.y) > MOVE_TOLERANCE) cancel();
  };

  if (view?.PointerEvent) {
    listen(doc, 'pointerdown', event => {
      if (!isTouchInput(event)) return;
      touched();
      pointers.add(event.pointerId);
      if (pointers.size > 1) cancel();
    });
    listen(container, 'pointerdown', event => {
      if (!isTouchInput(event)) return;
      touched();
      if (pointers.size === 1 && event.isPrimary !== false) begin(event, event.target, event.pointerId);
    });
    listen(doc, 'pointermove', event => {
      if (pending?.id === event.pointerId) move(event);
    });
    const end = event => {
      if (!isTouchInput(event)) return;
      touched();
      pointers.delete(event.pointerId);
      if (pending?.id === event.pointerId) cancel();
    };
    listen(doc, 'pointerup', end);
    listen(doc, 'pointercancel', end);
    listen(container, 'lostpointercapture', end);
  } else {
    listen(doc, 'touchstart', event => {
      touched();
      if (event.touches.length !== 1) cancel();
    });
    listen(container, 'touchstart', event => {
      touched();
      if (event.touches.length === 1) begin(event.touches[0], event.target, event.touches[0].identifier);
    });
    listen(doc, 'touchmove', event => {
      if (event.touches.length !== 1) { cancel(); return; }
      move(event.touches[0]);
    });
    const end = () => { touched(); cancel(); };
    listen(doc, 'touchend', end);
    listen(doc, 'touchcancel', end);
  }
  listen(container, 'contextmenu', event => {
    // Mobile browsers may synthesize a context menu before the finger is lifted.
    if ((pending || Date.now() < ignoreMouseUntil) && !event.target?.closest?.('.leaflet-control') &&
        resolve(map.mouseEventToLatLng(event))) event.preventDefault();
  }, { capture: true, passive: false });
  const reset = () => { pointers.clear(); cancel(); };
  if (view) listen(view, 'blur', reset);
  listen(doc, 'visibilitychange', reset);
  map.on('movestart zoomstart', cancel);
  return {
    cancel, shouldIgnoreHover,
    destroy() {
      reset();
      listeners.forEach(remove => remove());
      map.off('movestart zoomstart', cancel);
    },
  };
}
