// DXF Viewer — dark canvas, measure tools.
// Kept dark since drawings need contrast; chrome still minimal.
const { useState: useStateX } = React;

function DXFView({ fileName, onNav }) {
  const [tool, setTool] = useStateX('distance');
  const [layers, setLayers] = useStateX({ line: true, circle: true, arc: true, dim: true, text: true });

  const canvasBg = '#111418';
  const gridLine = '#1e2429';
  const gridMajor = '#262e35';

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: canvasBg, color: '#d4dae0', fontFamily: T.font, overflow: 'hidden',
    }}>
      {/* Top bar */}
      <div style={{
        height: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 14,
        background: '#181c20', borderBottom: '1px solid #262e35', flexShrink: 0,
      }}>
        <a onClick={() => onNav({ view: 'detail', job: '25214' })} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d4dae0', cursor: 'pointer', fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="back" size={13}/> 工番に戻る
        </a>
        <div style={{ width: 1, height: 18, background: '#262e35' }}/>
        <div style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 600, color: '#e6ebf0' }}>{fileName || '25214_本体01.dxf'}</div>
        <div style={{ fontSize: 11, color: '#7c8794' }}>本体ベース</div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 11, color: '#7c8794', fontFamily: T.mono }}>SS400 t=12 / 単位 mm</span>
        <button onClick={() => onNav({ view: 'detail', job: '25214' })} style={{
          width: 26, height: 26, borderRadius: 4, background: 'transparent', border: 'none',
          color: '#9aa3b2', cursor: 'pointer', display: 'grid', placeItems: 'center',
        }}><Icon name="x" size={14}/></button>
      </div>

      {/* Tool bar */}
      <div style={{
        height: 40, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 2,
        background: '#1a1f24', borderBottom: '1px solid #262e35', flexShrink: 0,
      }}>
        {[
          { k: 'distance', l: '距離計測', icon: 'ruler' },
          { k: 'angle',    l: '角度計測', icon: 'angle' },
        ].map(t => (
          <button key={t.k} onClick={() => setTool(t.k)} style={{
            padding: '6px 11px', fontSize: 12, fontWeight: 600,
            color: tool === t.k ? T.accent : '#9aa3b2',
            background: tool === t.k ? 'rgba(6,182,212,0.1)' : 'transparent',
            border: tool === t.k ? `1px solid ${T.accent}66` : '1px solid transparent',
            borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: T.font,
          }}>
            <Icon name={t.icon} size={12}/>
            {t.l}
          </button>
        ))}
        <button style={dxfToolBtn()}><Icon name="trash" size={12}/> クリア</button>
        <div style={{ width: 1, height: 18, background: '#262e35', margin: '0 6px' }}/>
        <button style={dxfToolBtn()}><Icon name="zoom-in" size={12}/></button>
        <button style={dxfToolBtn()}><Icon name="zoom-out" size={12}/></button>
        <button style={dxfToolBtn()}>FIT</button>
        <div style={{ flex: 1 }}/>
        <button style={dxfToolBtn()}><Icon name="print" size={12}/> 印刷</button>
        <button style={dxfToolBtn()}><Icon name="download" size={12}/> DLパス</button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <pattern id="dxf-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={gridLine} strokeWidth="0.5"/>
            </pattern>
            <pattern id="dxf-grid-major" width="200" height="200" patternUnits="userSpaceOnUse">
              <path d="M 200 0 L 0 0 0 200" fill="none" stroke={gridMajor} strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dxf-grid)"/>
          <rect width="100%" height="100%" fill="url(#dxf-grid-major)"/>

          {/* Origin */}
          <g stroke="#3a414a" strokeWidth="0.5">
            <line x1="600" y1="0" x2="600" y2="700"/>
            <line x1="0" y1="350" x2="1200" y2="350"/>
          </g>

          {/* Entities */}
          {layers.line && (
            <g stroke={T.accent} strokeWidth="1.4" fill="none">
              <rect x="350" y="180" width="500" height="340" rx="4"/>
              <rect x="400" y="220" width="400" height="260"/>
              <line x1="400" y1="350" x2="800" y2="350"/>
              <line x1="600" y1="220" x2="600" y2="480"/>
            </g>
          )}
          {layers.circle && (
            <g stroke="#fbbb98" strokeWidth="1.4" fill="none">
              <circle cx="400" cy="220" r="14"/>
              <circle cx="800" cy="220" r="14"/>
              <circle cx="400" cy="480" r="14"/>
              <circle cx="800" cy="480" r="14"/>
              <circle cx="600" cy="350" r="40"/>
              <circle cx="600" cy="350" r="60"/>
            </g>
          )}
          {layers.arc && (
            <g stroke="#f4c873" strokeWidth="1.4" fill="none">
              <path d="M 350 200 Q 350 180 370 180"/>
              <path d="M 850 200 Q 850 180 830 180"/>
              <path d="M 350 500 Q 350 520 370 520"/>
              <path d="M 850 500 Q 850 520 830 520"/>
            </g>
          )}
          {layers.dim && (
            <g stroke="#7c8794" strokeWidth="0.7" fill="none">
              <line x1="350" y1="550" x2="850" y2="550"/>
              <line x1="350" y1="545" x2="350" y2="555"/>
              <line x1="850" y1="545" x2="850" y2="555"/>
              <line x1="280" y1="180" x2="280" y2="520"/>
              <line x1="275" y1="180" x2="285" y2="180"/>
              <line x1="275" y1="520" x2="285" y2="520"/>
            </g>
          )}
          {layers.text && (
            <g fill="#9aa3b2" fontFamily="JetBrains Mono, monospace" fontSize="10">
              <text x="600" y="566" textAnchor="middle">500.00</text>
              <text x="268" y="354" textAnchor="middle" transform="rotate(-90 268 354)">340.00</text>
            </g>
          )}

          {/* User measurement (distance) */}
          {tool === 'distance' && (
            <g>
              <line x1="400" y1="220" x2="800" y2="220" stroke={T.accent} strokeWidth="1.5" strokeDasharray="4 3"/>
              <circle cx="400" cy="220" r="3.5" fill={T.accent} stroke="white" strokeWidth="1.5"/>
              <circle cx="800" cy="220" r="3.5" fill={T.accent} stroke="white" strokeWidth="1.5"/>
              <rect x="570" y="194" width="60" height="18" rx="3" fill={T.accent}/>
              <text x="600" y="207" textAnchor="middle" fill="white" fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="700">400.00</text>
            </g>
          )}
          {tool === 'angle' && (
            <g>
              <line x1="600" y1="350" x2="800" y2="220" stroke="#f4c873" strokeWidth="1.5" strokeDasharray="4 3"/>
              <line x1="600" y1="350" x2="800" y2="350" stroke="#f4c873" strokeWidth="1.5" strokeDasharray="4 3"/>
              <circle cx="800" cy="220" r="3.5" fill="#f4c873" stroke="white" strokeWidth="1.5"/>
              <circle cx="600" cy="350" r="3.5" fill="#f4c873" stroke="white" strokeWidth="1.5"/>
              <circle cx="800" cy="350" r="3.5" fill="#f4c873" stroke="white" strokeWidth="1.5"/>
              <path d="M 660 350 A 60 60 0 0 0 643 314" fill="none" stroke="#f4c873" strokeWidth="1.4"/>
              <rect x="655" y="324" width="44" height="18" rx="3" fill="#b48232"/>
              <text x="677" y="337" textAnchor="middle" fill="white" fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="700">33.0°</text>
            </g>
          )}
        </svg>

        {/* Layers panel */}
        <div style={panel({ top: 14, left: 14 })}>
          <div style={panelTitle()}>レイヤー</div>
          {[
            { k: 'line',   l: '外形',  c: T.accent },
            { k: 'circle', l: '穴',    c: '#fbbb98' },
            { k: 'arc',    l: 'R',     c: '#f4c873' },
            { k: 'dim',    l: '寸法',  c: '#7c8794' },
            { k: 'text',   l: 'テキスト', c: '#9aa3b2' },
          ].map(l => (
            <label key={l.k} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
              fontSize: 12, color: '#d4dae0', cursor: 'pointer',
            }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: l.c, flexShrink: 0 }}/>
              <input type="checkbox" checked={layers[l.k]} onChange={e => setLayers({ ...layers, [l.k]: e.target.checked })}
                     style={{ accentColor: T.accent, margin: 0 }}/>
              {l.l}
            </label>
          ))}
        </div>

        {/* Info panel */}
        <div style={panel({ top: 14, right: 14 })}>
          <div style={panelTitle()}>エンティティ情報</div>
          {[['LINE','48'],['CIRCLE','6'],['ARC','4'],['DIMENSION','12'],['TEXT','8']].map(([k, v], i) => (
            <div key={i} style={infoRow()}>
              <span style={{ color: '#7c8794' }}>{k}</span>
              <strong style={{ color: '#d4dae0', fontFamily: T.mono, fontWeight: 600 }}>{v}</strong>
            </div>
          ))}
          <div style={{ borderTop: '1px dashed #2e353d', marginTop: 8, paddingTop: 8 }}>
            <div style={infoRow()}><span style={{ color: '#7c8794' }}>サイズ</span><strong style={{ color: '#d4dae0', fontFamily: T.mono, fontWeight: 600 }}>124 KB</strong></div>
            <div style={infoRow()}><span style={{ color: '#7c8794' }}>単位</span><strong style={{ color: '#d4dae0', fontFamily: T.mono, fontWeight: 600 }}>mm</strong></div>
          </div>
        </div>

        {/* Measurements panel */}
        <div style={panel({ bottom: 14, right: 14, minWidth: 240 })}>
          <div style={panelTitle()}>測定 (2)</div>
          <div style={measRow()}>
            <span style={measChip(T.accent)}>距離</span>
            <span style={{ fontFamily: T.mono, fontWeight: 600, color: T.accent }}>400.00 mm</span>
          </div>
          <div style={measRow()}>
            <span style={measChip('#f4c873')}>角度</span>
            <span style={{ fontFamily: T.mono, fontWeight: 600, color: '#f4c873' }}>33.0°</span>
          </div>
          <button style={{
            width: '100%', marginTop: 8, padding: '6px', background: 'transparent',
            color: '#9aa3b2', border: '1px solid #2e353d', borderRadius: 5, fontSize: 11,
            cursor: 'pointer', fontFamily: T.font,
          }}>すべてクリア</button>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        height: 26, padding: '0 16px', background: '#181c20', borderTop: '1px solid #262e35',
        display: 'flex', alignItems: 'center', gap: 16, fontSize: 10.5, color: '#7c8794',
        fontFamily: T.mono, flexShrink: 0,
      }}>
        <span>X: <strong style={{ color: '#d4dae0', fontWeight: 600 }}>+247.50</strong></span>
        <span>Y: <strong style={{ color: '#d4dae0', fontWeight: 600 }}>+168.30</strong></span>
        <span style={{ color: '#3e4650' }}>|</span>
        <span>Zoom: <strong style={{ color: '#d4dae0', fontWeight: 600 }}>100%</strong></span>
        <span style={{ color: '#3e4650' }}>|</span>
        <span>モード: <span style={{ color: T.accent, fontWeight: 700 }}>{tool === 'distance' ? '距離計測中' : '角度計測中'}</span></span>
        <div style={{ flex: 1 }}/>
        <span>ホイール=ズーム / ドラッグ=パン / ESC=終了</span>
      </div>
    </div>
  );
}

function dxfToolBtn() {
  return {
    padding: '6px 9px', fontSize: 11.5, fontWeight: 500, color: '#9aa3b2',
    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: T.font,
  };
}
function panel(pos) {
  return {
    position: 'absolute', ...pos,
    background: 'rgba(24, 28, 32, 0.92)', backdropFilter: 'blur(8px)',
    border: '1px solid #262e35', borderRadius: 6, padding: '10px 12px',
    minWidth: 180,
  };
}
function panelTitle() {
  return {
    fontSize: 10, fontWeight: 700, color: '#7c8794',
    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
  };
}
function infoRow() {
  return {
    display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 11.5,
  };
}
function measRow() {
  return {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px dashed #2e353d', fontSize: 11.5,
  };
}
function measChip(c) {
  return {
    fontSize: 10, padding: '2px 7px', borderRadius: 999,
    background: c + '22', color: c, fontWeight: 600,
  };
}

window.DXFView = DXFView;
