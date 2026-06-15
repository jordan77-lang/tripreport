export const T = {
  accent:      '#2C5F3E',
  accentLight: '#EBF3ED',
  accentMid:   '#4A8B61',
  amber:       '#B8702E',
  amberLight:  '#FBF0E4',
  track:       '#5DBE7E',
  bg:          '#F5F4F0',
  card:        '#FFFFFF',
  text:        '#1A1917',
  textSub:     '#6B6763',
  textFaint:   '#A09D99',
  border:      '#E8E5E0',
};

export const F = "'Plus Jakarta Sans', system-ui, sans-serif";

export const ICONS = {
  home:     'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  home2:    'M9 22V12h6v10',
  map:      'M1 6l7-3 8 3 7-3v16l-7 3-8-3-7 3V6z',
  map2:     'M8 3v16 M16 6v16',
  plus:     'M12 5v14M5 12h14',
  journal:  'M4 19.5A2.5 2.5 0 016.5 17H20',
  journal2: 'M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  share:    'M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8',
  share2:   'M16 6l-4-4-4 4 M12 2v13',
  camera:   'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 8a4 4 0 100 8 4 4 0 000-8z',
  mic:      'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z M19 10v2a7 7 0 01-14 0v-2 M12 19v4 M8 23h8',
  video:    'M23 7l-7 5 7 5V7z M1 5h14a2 2 0 012 2v10a2 2 0 01-2 2H1',
  tent:     'M3 17l9-14 9 14H3z M12 3v14',
  leaf:     'M17 8C8 10 5.9 16.17 3.82 19h3.45C9 17 12 14 17 8z M21 3L3 21',
  drop:     'M12 2.69l5.66 5.66a8 8 0 11-11.31 0z',
  fork:     'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2 M7 2v20 M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3z M21 15v7',
  compass:  'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
  users:    'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 100 8 4 4 0 000-8z',
  chevR:    'M9 18l6-6-6-6',
  note:     'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  gauge:    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
};

export const KNOWN_GAUGES = [
  { id: '09498500', name: 'Salt River above Canyon Lake, AZ' },
  { id: '09380000', name: 'Colorado River at Lees Ferry, AZ' },
  { id: '09402500', name: 'Little Colorado River, AZ' },
  { id: '14138900', name: 'Sandy River near Marmot, OR' },
];

export const CAPTURE_MODES = {
  camping: [
    { icon: ICONS.mic,    label: 'Voice',  col: '#5B8DD9', type: 'voice' },
    { icon: ICONS.video,  label: 'Video',  col: '#C05050', type: 'video' },
    { icon: ICONS.note,   label: 'Journal', col: '#6B6763', type: 'note' },
    { icon: ICONS.fork,   label: 'Dinner', col: '#B06030', type: 'food' },
    { icon: ICONS.tent,   label: 'Campsite', col: '#B8702E', type: 'campsite' },
    { icon: ICONS.drop,   label: 'Water',  col: '#4A8BC4', type: 'water' },
    { icon: ICONS.leaf,   label: 'Wildlife', col: '#4A7A34', type: 'wildlife' },
    { icon: ICONS.compass, label: 'Weather', col: '#517EA3', type: 'weather' },
    { icon: ICONS.plus,   label: 'Custom Event', col: '#2C5F3E', type: 'custom-event' },
  ],
  river: [
    { icon: ICONS.mic,    label: 'Voice',  col: '#5B8DD9', type: 'voice' },
    { icon: ICONS.video,  label: 'Video',  col: '#C05050', type: 'video' },
    { icon: ICONS.drop,   label: 'River Feature', col: '#3A72A8', type: 'river-feature' },
    { icon: ICONS.gauge,  label: 'River Flow', col: '#2A5C8E', type: 'gauge' },
    { icon: ICONS.tent,   label: 'Campsite', col: '#B8702E', type: 'campsite' },
    { icon: ICONS.leaf,   label: 'Wildlife', col: '#4A7A34', type: 'wildlife' },
    { icon: ICONS.compass, label: 'Weather', col: '#517EA3', type: 'weather' },
    { icon: ICONS.fork,   label: 'Dinner', col: '#B06030', type: 'food' },
    { icon: ICONS.note,   label: 'Journal', col: '#6B6763', type: 'note' },
    { icon: ICONS.plus,   label: 'Custom Event', col: '#2C5F3E', type: 'custom-event' },
  ],
};
