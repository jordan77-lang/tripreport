import { isImageSymbol } from '../lib/locationArt';

/** Draw a place emoji inside a circle, or a custom icon when the symbol is an image. */
export function applyMapSymbol(el, symbol, {
  size = 36,
  cursor = 'pointer',
  color = '#2C5F3E',
  ring = 3,
  fontSize,
  shadow = '0 2px 9px rgba(0,0,0,.3)',
} = {}) {
  el.replaceChildren();
  if (isImageSymbol(symbol)) {
    const box = Math.round(size * 1.35);
    el.style.cssText = `width:${box}px;height:${box}px;cursor:${cursor};line-height:0;`;
    const img = document.createElement('img');
    img.src = symbol;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));';
    el.appendChild(img);
    return;
  }
  const textSize = fontSize || Math.round(size * 0.42);
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${ring}px solid white;box-shadow:${shadow};cursor:${cursor};display:flex;align-items:center;justify-content:center;font-size:${textSize}px;color:white;font-weight:700;line-height:1;`;
  el.textContent = symbol || '';
}

export function createPinElement(symbol) {
  const el = document.createElement('div');
  if (symbol) {
    applyMapSymbol(el, symbol, {
      size: 44,
      cursor: 'grab',
      color: '#B8702E',
      ring: 3,
      fontSize: 22,
      shadow: '0 3px 8px rgba(0,0,0,.35)',
    });
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
