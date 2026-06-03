// Modals — Release + Mail compose
const { useState: useStateM } = React;

function Modal({ open, onClose, title, subtitle, children, footer, width = 580 }) {
  if (!open) return null;
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(12,22,38,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 100,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        width, maxWidth: '92vw', maxHeight: '88vh',
        background: T.surface, borderRadius: 10,
        boxShadow: '0 20px 50px -10px rgba(12,22,38,0.25)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: T.font,
      }}>
        <div style={{
          padding: '18px 22px', borderBottom: `1px solid ${T.hair}`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: T.ink3, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, background: 'transparent',
            border: 'none', color: T.ink2, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="x" size={15}/></button>
        </div>
        <div style={{ padding: '18px 22px', overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{
            padding: '14px 22px', borderTop: `1px solid ${T.hair}`,
            display: 'flex', gap: 8, justifyContent: 'flex-end', background: T.surfaceAlt,
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

function FormGroup({ label, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontSize: 11.5, fontWeight: 600, color: T.ink2,
        marginBottom: 6, letterSpacing: '0.02em',
      }}>{label} {required && <span style={{ color: T.danger }}>*</span>}</label>
      {children}
    </div>
  );
}

function input(extra = {}) {
  return {
    width: '100%', height: 32, padding: '0 12px',
    border: `1px solid ${T.hair2}`, borderRadius: 6, fontSize: 13,
    color: T.ink, outline: 'none', background: T.surface, fontFamily: T.font,
    boxSizing: 'border-box', ...extra,
  };
}

function ReleaseModal({ open, onClose, onSent }) {
  const [axis, setAxis] = useStateM('昇降軸');
  const [notify, setNotify] = useStateM(true);
  return (
    <Modal open={open} onClose={onClose}
      title="軸を出図"
      subtitle="25214 コマツ金沢 / アライメント装置"
      footer={
        <>
          <button onClick={onClose} style={ghostBtn()}>キャンセル</button>
          <button onClick={() => { onClose(); onSent(notify); }} style={primaryBtn()}>
            出図 {notify && '+ メール'} →
          </button>
        </>
      }>
      <FormGroup label="軸" required>
        <select value={axis} onChange={e => setAxis(e.target.value)} style={input({ height: 36 })}>
          <option>昇降軸</option><option>旋回軸</option><option>走行軸</option>
        </select>
      </FormGroup>
      <FormGroup label="PDF パス" required>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: '10px 12px', border: `1px solid ${T.hair2}`, borderRadius: 6, background: T.surfaceAlt,
        }}>
          <FileIcon type="pdf"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>25214_{axis === '昇降軸' ? '昇降' : axis === '旋回軸' ? '旋回' : '走行'}.pdf</div>
            <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.ink3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              \\lineworks-sv\Data\設計\drawings\25214\{axis === '昇降軸' ? '昇降' : axis === '旋回軸' ? '旋回' : '走行'}.pdf
            </div>
          </div>
          <button style={{ ...ghostBtn(), padding: '4px 10px', fontSize: 11.5 }}>変更</button>
        </div>
      </FormGroup>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormGroup label="出図者名">
          <input style={input()} defaultValue="山田"/>
        </FormGroup>
        <FormGroup label="コメント">
          <input style={input()} defaultValue="初回出図"/>
        </FormGroup>
      </div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        background: T.accentSoft, border: `1px solid #cffafe`, borderRadius: 6,
        cursor: 'pointer',
      }}>
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)}
               style={{ accentColor: T.accent, margin: 0, width: 15, height: 15 }}/>
        <div style={{ fontSize: 12.5, color: T.accent2, fontWeight: 600 }}>出図通知メールを作成する</div>
      </label>
    </Modal>
  );
}

function MailModal({ open, onClose, onSent }) {
  const [tpl, setTpl] = useStateM('出図通知（標準）');
  return (
    <Modal open={open} onClose={onClose}
      title="メールを作成"
      subtitle="テンプレートを選んで、宛先と本文を編集"
      width={620}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn()}>キャンセル</button>
          <button onClick={() => { onClose(); onSent(); }} style={primaryBtn()}>
            <Icon name="mail" size={12}/> 下書きを作成
          </button>
        </>
      }>
      <FormGroup label="テンプレート">
        <select value={tpl} onChange={e => setTpl(e.target.value)} style={input({ height: 36 })}>
          {AppData.TEMPLATES.map(t => <option key={t.name}>{t.name}</option>)}
        </select>
      </FormGroup>
      <FormGroup label="宛先">
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, padding: '7px 10px',
          border: `1px solid ${T.hair2}`, borderRadius: 6, minHeight: 36,
          alignItems: 'center', background: T.surface,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: T.accentSoft, color: T.accent2, border: `1px solid #cffafe`,
            borderRadius: 4, padding: '3px 4px 3px 9px', fontSize: 12, fontWeight: 600,
          }}>コマツ金沢 田中様
            <button style={{
              width: 16, height: 16, borderRadius: '50%', background: 'rgba(8,145,178,0.15)',
              border: 'none', fontSize: 10, color: T.accent2,
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}>×</button>
          </span>
          <button style={{
            padding: '3px 9px', border: `1px dashed ${T.hair2}`, borderRadius: 4,
            fontSize: 11.5, color: T.ink3, background: 'transparent', cursor: 'pointer', fontWeight: 500,
          }}>＋ 連絡先を選択</button>
        </div>
      </FormGroup>
      <FormGroup label="件名">
        <input style={input()} defaultValue="【出図通知】25214 コマツ金沢 / 昇降軸"/>
      </FormGroup>
      <FormGroup label="本文">
        <textarea style={{
          ...input(),
          height: 200, padding: 12, resize: 'vertical', lineHeight: 1.6, fontSize: 12.5,
        }} defaultValue={`コマツ金沢
田中様

いつもお世話になっております。

下記、出図のお知らせです。
工番:   25214
軸:     昇降軸
納期:   6/30
パス:   \\\\lineworks-sv\\Data\\設計\\drawings\\25214\\昇降.pdf

ご確認のほど、よろしくお願いいたします。
山田`}/>
      </FormGroup>
    </Modal>
  );
}

Object.assign(window, { ReleaseModal, MailModal });
