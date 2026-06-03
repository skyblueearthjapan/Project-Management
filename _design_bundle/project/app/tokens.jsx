// Minimal design tokens — Stock-inspired
window.T = {
  bg: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#fafbfc',
  hair: '#eceef2',
  hair2: '#dfe2e8',
  hair3: '#c4cad3',
  ink: '#0c1626',
  ink2: '#5a6473',
  ink3: '#9aa3b2',
  ink4: '#c4cad3',
  accent: '#06b6d4',
  accent2: '#0891b2',
  accentSoft: '#ecfdff',
  warn: '#b45309',
  warnSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  ok: '#047857',

  font: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

// Helper components
const { useState, useEffect, useRef, useMemo } = React;

function Icon({ name, size = 14, stroke = 2, color = 'currentColor' }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: stroke,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'search':   return <svg {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'plus':     return <svg {...props} strokeWidth={2.5}><path d="M12 5v14M5 12h14"/></svg>;
    case 'mail':     return <svg {...props}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    case 'back':     return <svg {...props} strokeWidth={2.5}><polyline points="15 18 9 12 15 6"/></svg>;
    case 'forward':  return <svg {...props} strokeWidth={2.5}><polyline points="9 18 15 12 9 6"/></svg>;
    case 'up':       return <svg {...props} strokeWidth={2.5}><polyline points="18 15 12 9 6 15"/></svg>;
    case 'down':     return <svg {...props} strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>;
    case 'check':    return <svg {...props} strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'x':        return <svg {...props}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case 'home':     return <svg {...props}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'settings': return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case 'download': return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    case 'print':    return <svg {...props}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
    case 'star':     return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/></svg>;
    case 'star-o':   return <svg {...props}><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/></svg>;
    case 'file':     return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case 'more':     return <svg {...props}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
    case 'edit':     return <svg {...props}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'ruler':    return <svg {...props}><line x1="2" y1="12" x2="22" y2="12"/><circle cx="4" cy="12" r="2" fill={color}/><circle cx="20" cy="12" r="2" fill={color}/></svg>;
    case 'angle':    return <svg {...props}><path d="M3 21 L3 3 L21 21 Z"/><path d="M9 21 A6 6 0 0 0 3 15"/></svg>;
    case 'zoom-in':  return <svg {...props}><circle cx="11" cy="11" r="8"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'zoom-out': return <svg {...props}><circle cx="11" cy="11" r="8"/><line x1="8" y1="11" x2="14" y2="11"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'trash':    return <svg {...props}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>;
    case 'expand':   return <svg {...props}><path d="M3 3h7v2H5v5H3V3zm18 0v7h-2V5h-5V3h7zM3 21v-7h2v5h5v2H3zm18 0h-7v-2h5v-5h2v7z"/></svg>;
    case 'bell':     return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>;
    default:         return null;
  }
}

window.Icon = Icon;
