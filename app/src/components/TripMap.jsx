import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const webglSupported = (() => {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
})();

// style options: 'outdoors-v12' | 'satellite-streets-v12' | 'streets-v12'
export function TripMap({
  style = 'outdoors-v12',
  position,          // {lng, lat} — live GPS dot
  track = [],        // [{lng, lat}] — recorded path
  entries = [],      // [{lng, lat, type, title, col}] — pin markers
  center,            // {lng, lat} override
  zoom = 13,
  interactive = true,
  onMapClick,
  onEntrySelect,
  selectedEntryId,
  showHoverPopup = false,
}) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markersRef   = useRef([]);
  const initialConfigRef = useRef(null);
  if (initialConfigRef.current == null) {
    initialConfigRef.current = { style, center, position, zoom, interactive };
  }

  if (!webglSupported) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: '#E8E5E0', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6B6763' }}>Map unavailable</div>
        <div style={{ fontSize: 11, color: '#A09D99', textAlign: 'center', padding: '0 20px' }}>
          WebGL is not supported in this browser. Open in Chrome or Safari to use the map.
        </div>
      </div>
    );
  }

  // Init map
  useEffect(() => {
    if (mapRef.current) return;
    const cfg = initialConfigRef.current;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: `mapbox://styles/mapbox/${cfg.style}`,
      center: cfg.center
        ? [cfg.center.lng, cfg.center.lat]
        : cfg.position
          ? [cfg.position.lng, cfg.position.lat]
          : [-111.5, 33.6], // Salt River, AZ default
      zoom: cfg.zoom,
      interactive: cfg.interactive,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    }), 'top-right');

    map.on('load', () => {
      // Track line source
      map.addSource('track', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
      });
      map.addLayer({
        id: 'track-line',
        type: 'line',
        source: 'track',
        paint: { 'line-color': '#5DBE7E', 'line-width': 4, 'line-opacity': 0.9 },
      });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onMapClick) return;
    const handleClick = (e) => onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [onMapClick]);

  // Update track when points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('track');
    if (!src) return;
    src.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: track.map(p => [p.lng, p.lat]) },
    });
  }, [track]);

  // Update live position dot — fly to position on first fix
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    // Fly to position only on first fix (zoom in from default)
    if (map.getZoom() <= 5 || !map.getSource('track')) {
      map.flyTo({ center: [position.lng, position.lat], zoom: 14, speed: 1.4 });
    }
  }, [position]);

  // Focus map when caller changes center
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.flyTo({ center: [center.lng, center.lat], zoom, speed: 1.1 });
  }, [center, zoom]);

  // Entry markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = entries
      .filter(e => e.lng && e.lat)
      .map(e => {
        const isSelected = selectedEntryId != null && String(selectedEntryId) === String(e.id);
        const el = document.createElement('div');
        el.style.cssText = `width:${isSelected ? 44 : 36}px;height:${isSelected ? 44 : 36}px;border-radius:50%;background:${e.col || '#2C5F3E'};
          border:${isSelected ? 4 : 3}px solid white;box-shadow:${isSelected ? '0 4px 14px rgba(0,0,0,.45)' : '0 2px 9px rgba(0,0,0,.3)'};cursor:pointer;
          display:flex;align-items:center;justify-content:center;font-size:${isSelected ? 18 : 15}px;color:white;font-weight:700;line-height:1;`;
        el.textContent = e.symbol || '';
        el.title = e.title || e.type;
        if (onEntrySelect) {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onEntrySelect(e);
          });
        }
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([e.lng, e.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(
            `<div style="font-family:system-ui;font-size:13px;font-weight:700">${e.title || e.type}</div>`
          ))
          .addTo(map);

        if (showHoverPopup) {
          el.addEventListener('mouseenter', () => {
            if (!marker.getPopup().isOpen()) marker.togglePopup();
          });
          el.addEventListener('mouseleave', () => {
            if (marker.getPopup().isOpen()) marker.togglePopup();
          });
        }

        return marker;
      });
  }, [entries, onEntrySelect, selectedEntryId, showHoverPopup]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  );
}
