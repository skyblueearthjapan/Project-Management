// Shared chrome — Topbar, BottomNav for mobile
const { useState: useStateC } = React;

function Topbar({ nav, onNav }) {
  const items = [
    { k: 'index', l: '工番' },
    { k: 'admin', l: '管理' },
  ];
  return (
    <div style={{
      height: 54, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 18,
      borderBottom: `1px solid ${T.hair}`, background: T.surface, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }} onClick={() => onNav({ view: 'index' })}>
        <div style={{
          width: 22, height: 22, borderRadius: 5, background: T.accent,
          display: 'grid', placeItems: 'center',
        }}>
          <div style={{ width: 9, height: 9, background: T.surface, borderRadius: 1 }}/>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', color: T.ink }}>
          Project Management
        </div>
      </div>

      <nav style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        {items.map(t => {
          const active = nav.view === t.k || (t.k === 'index' && (nav.view === 'detail' || nav.view === 'dxf'));
          return (
            <a key={t.k} onClick={() => onNav({ view: t.k })}
               style={{
                 padding: '6px 11px', fontSize: 13, fontWeight: 500,
                 color: active ? T.ink : T.ink2, borderRadius: 6,
                 background: active ? T.hair : 'transparent', cursor: 'pointer',
               }}>{t.l}</a>
          );
        })}
      </nav>

      <div style={{ flex: 1 }}/>

      <div style={{ position: 'relative', width: 240 }}>
        <input
          placeholder="検索…"
          style={{
            width: '100%', height: 30, padding: '0 12px 0 32px',
            background: T.surfaceAlt, border: `1px solid ${T.hair}`, borderRadius: 6,
            fontSize: 12.5, color: T.ink, outline: 'none', fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', left: 11, top: 9 }}><Icon name="search" size={12} stroke={2.2} color={T.ink3}/></span>
      </div>

      <button onClick={() => window.openModal && window.openModal('release')} style={{
        height: 30, padding: '0 13px', borderRadius: 6, background: T.accent, color: T.surface,
        border: 'none', fontWeight: 600, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <Icon name="plus" size={12} stroke={2.6}/>
        出図
      </button>

      <button style={{
        width: 30, height: 30, borderRadius: 6, background: 'transparent', border: `1px solid ${T.hair}`,
        color: T.ink2, cursor: 'pointer', display: 'grid', placeItems: 'center', position: 'relative',
      }}>
        <Icon name="bell" size={13} stroke={1.8}/>
        <span style={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: T.accent }}/>
      </button>

      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: T.surfaceAlt,
        display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, color: T.ink2,
        border: `1px solid ${T.hair}`,
      }}>山</div>
    </div>
  );
}

function dueColorOf(dueStatus) {
  if (dueStatus === 'over') return T.danger;
  if (dueStatus === 'warn') return T.warn;
  return T.ink2;
}

// Quiet phase progress bar
function ProgressBar({ job, compact = false }) {
  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <div style={{ position: 'relative', height: compact ? 3 : 4, background: T.hair, borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${job.pct}%`, background: T.accent, borderRadius: 2,
        }}/>
        {AppData.PHASES.map((p, i) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${(i / AppData.PHASES.length) * 100}%`,
            top: -2, bottom: -2, width: 1, background: T.surface,
          }}/>
        ))}
        <div style={{
          position: 'absolute', left: `${((job.nowPhase - 0.5) / AppData.PHASES.length) * 100}%`,
          top: '50%', transform: 'translate(-50%, -50%)',
          width: compact ? 8 : 9, height: compact ? 8 : 9, borderRadius: '50%', background: T.surface,
          border: `2px solid ${T.accent}`,
        }}/>
      </div>
      {!compact && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${AppData.PHASES.length}, 1fr)`, marginTop: 6 }}>
          {AppData.PHASES.map((p, i) => (
            <div key={p.i} style={{
              fontSize: 9.5, color: i + 1 === job.nowPhase ? T.ink : T.ink3,
              fontWeight: i + 1 === job.nowPhase ? 600 : 400,
              textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>{p.ja}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toast({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
      padding: '10px 18px', background: T.ink, color: T.surface,
      borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 999,
      boxShadow: '0 6px 24px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: T.font,
    }}>
      <Icon name="check" size={14} color={T.accent}/>
      {msg}
    </div>
  );
}

Object.assign(window, { Topbar, ProgressBar, Toast, dueColorOf });
