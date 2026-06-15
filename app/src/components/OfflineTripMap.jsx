import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildOfflineMapStyle } from '../lib/offlineMapStyle';

let protocolInstalled = false;

function ensurePmtilesProtocol() {
  if (protocolInstalled || typeof maplibregl.addProtocol !== 'function') return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolInstalled = true;
}

export function OfflineTripMap({
  pmtilesUrl,
  position,
  track = [],
  entries = [],
  center,
  zoom = 13,
  interactive = true,
  onMapClick,
  onEntrySelect,
  selectedEntryId,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!pmtilesUrl || mapRef.current) return;
    ensurePmtilesProtocol();

    const initialCenter = center
      ? [center.lng, center.lat]
      : position
        ? [position.lng, position.lat]
        : [-111.5, 33.6];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildOfflineMapStyle(pmtilesUrl),
      center: initialCenter,
      zoom,
      interactive,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    }), 'top-right');

    map.on('load', () => {
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pmtilesUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onMapClick) return;
    const handleClick = (e) => onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [onMapClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('track');
    if (!src) return;
    src.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: track.map((p) => [p.lng, p.lat]) },
    });
  }, [track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.flyTo({ center: [center.lng, center.lat], zoom, speed: 1.1 });
  }, [center, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    if (map.getZoom() <= 5) {
      map.flyTo({ center: [position.lng, position.lat], zoom: 14, speed: 1.4 });
    }
  }, [position]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = entries
      .filter((e) => e.lng && e.lat)
      .map((e) => {
        const isSelected = selectedEntryId != null && String(selectedEntryId) === String(e.id);
        const el = document.createElement('div');
        el.style.cssText = `width:${isSelected ? 44 : 36}px;height:${isSelected ? 44 : 36}px;border-radius:50%;background:${e.col || '#2C5F3E'};
          border:${isSelected ? 4 : 3}px solid white;box-shadow:0 2px 9px rgba(0,0,0,.3);cursor:pointer;
          display:flex;align-items:center;justify-content:center;font-size:${isSelected ? 18 : 15}px;color:white;font-weight:700;`;
        el.textContent = e.symbol || '';
        if (onEntrySelect) {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onEntrySelect(e);
          });
        }
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([e.lng, e.lat])
          .addTo(map);
        return marker;
      });
  }, [entries, onEntrySelect, selectedEntryId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
