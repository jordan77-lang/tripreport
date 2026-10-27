import { trackSegments } from '../lib/tripTimeline';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { OfflineTripMap } from './OfflineTripMap';
import { resolveOfflineMapForTrip } from '../lib/offlineMaps';
import { syncPinMarker } from './mapPin';

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
  position,
  track = [],
  entries = [],
  center,
  zoom = 13,
  interactive = true,
  onMapClick,
  onEntrySelect,
  selectedEntryId,
  showHoverPopup = false,
  offlineRegionIds = [],
  trip = null,
  pin = null,
  onPinChange,
  onReady = null,
}) {
  const [offlinePack, setOfflinePack] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrl = null;

    async function load() {
      const ids = offlineRegionIds.length ? offlineRegionIds : (trip?.offlineRegions || []);
      const mapArea = trip?.mapArea || null;
      if (!ids.length && !mapArea) {
        setOfflinePack(null);
        return;
      }
      const resolved = await resolveOfflineMapForTrip({ offlineRegions: ids, mapArea });
      if (cancelled) return;
      if (resolved?.blobUrl || resolved?.kind === 'cached-area') {
        if (resolved.blobUrl) blobUrl = resolved.blobUrl;
        setOfflinePack(resolved);
      } else {
        setOfflinePack(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [offlineRegionIds, trip?.offlineRegions, trip?.mapArea]);

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const shouldUseOfflineMap = Boolean(
    offlinePack?.blobUrl
    || (offlinePack?.kind === 'cached-area' && (isOffline || !mapboxgl.accessToken)),
  );

  if (shouldUseOfflineMap) {
    return (
      <OfflineTripMap
        pmtilesUrl={offlinePack.blobUrl}
        cachedArea={offlinePack.mapArea}
        position={position}
        track={track}
        entries={entries}
        center={center || offlinePack.region?.center || offlinePack.center}
        zoom={zoom}
        interactive={interactive}
        onMapClick={onMapClick}
        onEntrySelect={onEntrySelect}
        selectedEntryId={selectedEntryId}
        pin={pin}
        onPinChange={onPinChange}
        onReady={onReady}
      />
    );
  }

  return (
    <MapboxTripMap
      style={style}
      position={position}
      track={track}
      entries={entries}
      center={center}
      zoom={zoom}
      interactive={interactive}
      onMapClick={onMapClick}
      onEntrySelect={onEntrySelect}
      selectedEntryId={selectedEntryId}
      showHoverPopup={showHoverPopup}
      pin={pin}
      onPinChange={onPinChange}
      onReady={onReady}
    />
  );
}

function MapboxTripMap({
  style = 'outdoors-v12',
  position,
  track = [],
  entries = [],
  center,
  zoom = 13,
  interactive = true,
  onMapClick,
  onEntrySelect,
  selectedEntryId,
  showHoverPopup = false,
  pin = null,
  onPinChange,
  onReady = null,
}) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const trackRef = useRef(track);
  useEffect(()=>{trackRef.current=track;},[track]);
  const markersRef   = useRef([]);
  const pinMarkerRef = useRef(null);
  const onPinChangeRef = useRef(onPinChange);
  const onMapClickRef = useRef(onMapClick);
  const pinRef = useRef(pin);
  const lastCenterRef = useRef(null);
  const initialConfigRef = useRef(null);
  if (initialConfigRef.current == null) {
    initialConfigRef.current = { style, center, position, zoom, interactive };
  }

  // Keep the drag callback fresh without re-creating the marker on every render.
  useEffect(() => {
    onPinChangeRef.current = onPinChange;
    onMapClickRef.current = onMapClick;
    pinRef.current = pin;
  }, [onPinChange, onMapClick, pin]);

  // Init map
  useEffect(() => {
    if (!webglSupported || !mapboxgl.accessToken) return;
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

    map.on('click', (e) => onMapClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

    map.on('load', () => {
      map.resize();
      syncPinMarker(mapboxgl.Marker, map, pinMarkerRef, pinRef.current, onPinChangeRef);
      // Track line source
      map.addSource('track', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: trackSegments(trackRef.current).filter(s=>s.length>1).map(s=>s.map(p=>[p.lng,p.lat])) } },
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

  // Hand the caller an imperative flyTo so place search can move the viewport
  // without remounting the map or disturbing the pin.
  useEffect(() => {
    if (!onReady) return undefined;
    const flyTo = ({ lng, lat, bbox, zoom: toZoom } = {}) => {
      const map = mapRef.current;
      if (!map) return;
      if (bbox) {
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 700, maxZoom: 15 });
        return;
      }
      if (lng == null || lat == null) return;
      map.flyTo({ center: [lng, lat], zoom: toZoom ?? Math.max(map.getZoom(), 13), duration: 700 });
    };
    const getCenter = () => {
      const c = mapRef.current?.getCenter();
      return c ? { lng: c.lng, lat: c.lat } : null;
    };
    onReady({ flyTo, getCenter });
    return () => onReady(null);
  }, [onReady]);

  // Draggable pin — the coordinate the user is actually choosing.
  useEffect(() => {
    syncPinMarker(mapboxgl.Marker, mapRef.current, pinMarkerRef, pin, onPinChangeRef);
  }, [pin]);

  useEffect(() => () => {
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
  }, []);

  // Update track when points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('track');
    if (!src) return;
    src.setData({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: trackSegments(track).filter(s=>s.length>1).map(s=>s.map(p=>[p.lng,p.lat])) },
    });
  }, [track]);

  // Update live position dot — fly to position on first fix
  useEffect(() => {
    const map=mapRef.current;
    if(!map || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng))return;
    const dot=document.createElement('div');
    dot.setAttribute('aria-label','Your last GPS location');
    dot.title='Your last GPS location';
    dot.style.cssText='width:16px;height:16px;border-radius:50%;background:#2877d4;border:3px solid white;box-shadow:0 0 0 5px #2877d433;';
    const marker=new mapboxgl.Marker({element:dot}).setLngLat([position.lng,position.lat]).addTo(map);
    return ()=>marker.remove();
  },[position]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    // Fly to position only on first fix (zoom in from default)
    if (map.getZoom() <= 5 || !map.getSource('track')) {
      map.flyTo({ center: [position.lng, position.lat], zoom: 14, speed: 1.4 });
    }
  }, [position]);

  // Focus map when the caller changes center. Compared by value: callers often
  // pass a fresh object each render, and re-flying would fight place search and
  // pin drags by yanking the viewport back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || center.lng == null || center.lat == null) return;
    const prev = lastCenterRef.current;
    if (prev && Math.abs(prev.lng - center.lng) < 1e-9 && Math.abs(prev.lat - center.lat) < 1e-9) return;
    lastCenterRef.current = { lng: center.lng, lat: center.lat };
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

  // Checked after the hooks so hook order stays stable across renders.
  if (!webglSupported || !mapboxgl.accessToken) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: '#E8E5E0', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6B6763' }}>Map unavailable</div>
        <div style={{ fontSize: 11, color: '#A09D99', textAlign: 'center', padding: '0 20px' }}>
          {!mapboxgl.accessToken
            ? 'The online map is unavailable. Downloaded map packs can still be used.'
            : 'WebGL is not supported in this browser. Open in Chrome or Safari to use the map.'}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  );
}
