import { trackSegments } from '../lib/tripTimeline';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildOfflineMapStyle } from '../lib/offlineMapStyle';
import { syncPinMarker } from './mapPin';

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
  pin = null,
  onPinChange,
  onReady = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const trackRef = useRef(track);
  useEffect(()=>{trackRef.current=track;},[track]);
  const markersRef = useRef([]);
  const pinMarkerRef = useRef(null);
  const onPinChangeRef = useRef(onPinChange);
  const onMapClickRef = useRef(onMapClick);
  const pinRef = useRef(pin);
  const lastCenterRef = useRef(null);
  useEffect(() => {
    onPinChangeRef.current = onPinChange;
    onMapClickRef.current = onMapClick;
    pinRef.current = pin;
  }, [onPinChange, onMapClick, pin]);

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

    map.on('click', (e) => onMapClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

    map.on('load', () => {
      map.resize();
      syncPinMarker(maplibregl.Marker, map, pinMarkerRef, pinRef.current, onPinChangeRef);
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pmtilesUrl]);

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

  useEffect(() => {
    syncPinMarker(maplibregl.Marker, mapRef.current, pinMarkerRef, pin, onPinChangeRef);
  }, [pin]);

  useEffect(() => () => {
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
  }, []);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || center.lng == null || center.lat == null) return;
    const prev = lastCenterRef.current;
    if (prev && Math.abs(prev.lng - center.lng) < 1e-9 && Math.abs(prev.lat - center.lat) < 1e-9) return;
    lastCenterRef.current = { lng: center.lng, lat: center.lat };
    map.flyTo({ center: [center.lng, center.lat], zoom, speed: 1.1 });
  }, [center, zoom]);

  useEffect(() => {
    const map=mapRef.current;
    if(!map || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng))return;
    const dot=document.createElement('div');
    dot.setAttribute('aria-label','Your last GPS location');
    dot.title='Your last GPS location';
    dot.style.cssText='width:16px;height:16px;border-radius:50%;background:#2877d4;border:3px solid white;box-shadow:0 0 0 5px #2877d433;';
    const marker=new maplibregl.Marker({element:dot}).setLngLat([position.lng,position.lat]).addTo(map);
    return ()=>marker.remove();
  },[position]);

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
