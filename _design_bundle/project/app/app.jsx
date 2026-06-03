// Main app shell + router. Holds navigation state and modals.
const { useState: useStateApp, useEffect: useEffectApp } = React;

function DesktopApp({ nav, setNav, openModal, toast }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: T.surface, color: T.ink, fontFamily: T.font, overflow: 'hidden',
      letterSpacing: '-0.005em',
    }}>
      {nav.view !== 'dxf' && <Topbar nav={nav} onNav={setNav}/>}
      {nav.view === 'index'  && <IndexView  onNav={setNav}/>}
      {nav.view === 'detail' && <DetailView jobNo={nav.job} onNav={setNav}/>}
      {nav.view === 'dxf'    && <DXFView fileName={nav.file} onNav={setNav}/>}
      {nav.view === 'admin'  && <AdminView onNav={setNav} onToast={toast}/>}
    </div>
  );
}

function MobileApp({ nav, setNav, toast }) {
  // mobile uses simpler nav: index | detail | admin
  const inDetail = nav.view === 'detail';
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: T.surface, color: T.ink, fontFamily: T.font, overflow: 'hidden',
    }}>
      <MobileStatusBar/>
      {nav.view === 'index'  && <MobileIndex  onNav={setNav}/>}
      {nav.view === 'detail' && <MobileDetail jobNo={nav.job} onNav={setNav}/>}
      {nav.view === 'admin'  && <MobileAdmin  onNav={setNav}/>}
      {!inDetail && (
        <MobileBottomNav
          tab={nav.view}
          onTab={k => setNav({ view: k })}
        />
      )}
    </div>
  );
}

function App() {
  const [device, setDevice] = useStateApp('desktop'); // desktop | mobile
  const [nav, setNav] = useStateApp({ view: 'index' });
  const [modal, setModal] = useStateApp(null);
  const [toastMsg, setToast] = useStateApp('');

  // expose openModal globally for chrome/buttons
  useEffectApp(() => {
    window.openModal = (m) => setModal(m);
  }, []);

  function toast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }

  // ESC closes modal / goes back in DXF
  useEffectApp(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (modal) setModal(null);
        else if (nav.view === 'dxf') setNav({ view: 'detail', job: '25214' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, nav]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#eef0f3' }}>
      {/* Device frame */}
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: device === 'mobile' ? 24 : 0, minHeight: 0 }}>
        {device === 'desktop' ? (
          <DesktopApp nav={nav} setNav={setNav} openModal={setModal} toast={toast}/>
        ) : (
          <div style={{
            width: 390, height: 'min(820px, calc(100vh - 100px))',
            borderRadius: 32, border: `1px solid ${T.hair2}`, overflow: 'hidden',
            boxShadow: '0 20px 60px -20px rgba(0,0,0,0.25), 0 0 0 8px #1a1f24',
            background: T.surface,
          }}>
            <MobileApp nav={nav} setNav={setNav} toast={toast}/>
          </div>
        )}
      </div>

      {/* Floating device toggle */}
      <div style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 50,
        background: T.surface, border: `1px solid ${T.hair2}`, borderRadius: 999,
        padding: 4, display: 'flex', gap: 2,
        boxShadow: '0 6px 20px -8px rgba(0,0,0,0.15)',
      }}>
        {[
          { k: 'desktop', l: 'Desktop' },
          { k: 'mobile',  l: 'Mobile' },
        ].map(d => (
          <button key={d.k} onClick={() => setDevice(d.k)} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            color: device === d.k ? T.surface : T.ink2,
            background: device === d.k ? T.ink : 'transparent',
            border: 'none', borderRadius: 999, cursor: 'pointer', fontFamily: T.font,
          }}>{d.l}</button>
        ))}
      </div>

      {/* Modals */}
      <ReleaseModal
        open={modal === 'release'}
        onClose={() => setModal(null)}
        onSent={(notify) => {
          if (notify) setModal('mail');
          else toast('出図しました');
        }}
      />
      <MailModal
        open={modal === 'mail'}
        onClose={() => setModal(null)}
        onSent={() => toast('Outlook に下書きを作成しました')}
      />

      <Toast msg={toastMsg}/>
    </div>
  );
}

window.App = App;
