export function createPinElement(symbol) {
  const el = document.createElement('div');
  if (symbol) {
    el.style.cssText = 'width:44px;height:44px;border-radius:50%;background:#B8702E;border:3px solid white;box-shadow:0 3px 8px rgba(0,0,0,.35);cursor:grab;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;';
    el.textContent = symbol;
    return el;
  }
  el.style.cssText = 'width:34px;height:46px;cursor:grab;line-height:0;';
  el.innerHTML = `
    <svg width="34" height="46" viewBox="0 0 34 46" style="display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,.4))">
      <path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 15 29 15 29s15-18.5 15-29C32 7.7 25.3 1 17 1z"
            fill="#2A5C8E" stroke="white" stroke-width="2.5"/>
      <circle cx="17" cy="16" r="5" fill="white"/>
    </svg>`;
  return el;
}

/** Show one draggable pin. The element's bottom tip sits on the coordinate. */
export function syncPinMarker(Marker, map, pinMarkerRef, pin, onPinChangeRef) {
  if (!map) return;
  if (!pin || pin.lng == null || pin.lat == null) {
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
    return;
  }

  const symbol = pin.symbol || '';
  if (pinMarkerRef.current && pinMarkerRef.current.__symbol !== symbol) {
    pinMarkerRef.current.remove();
    pinMarkerRef.current = null;
  }

  if (!pinMarkerRef.current) {
    const el = createPinElement(symbol);
    const marker = new Marker({ element: el, draggable: true, anchor: symbol ? 'center' : 'bottom' })
      .setLngLat([pin.lng, pin.lat])
      .addTo(map);
    marker.__symbol = symbol;
    marker.on('dragstart', () => { el.style.cursor = 'grabbing'; });
    marker.on('dragend', () => {
      el.style.cursor = 'grab';
      const { lng, lat } = marker.getLngLat();
      onPinChangeRef.current?.({ lng, lat });
    });
    pinMarkerRef.current = marker;
    return;
  }

  const current = pinMarkerRef.current.getLngLat();
  if (Math.abs(current.lng - pin.lng) > 1e-9 || Math.abs(current.lat - pin.lat) > 1e-9) {
    pinMarkerRef.current.setLngLat([pin.lng, pin.lat]);
  }
}
