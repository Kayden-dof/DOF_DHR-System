'use client';

import { useState } from 'react';
import { PASSPHRASE_MIN } from '@/lib/backup-lock-const';

/* ---------------------------------------------------------------------------
   백업 내려받기 (사용자 요청 2026-09-01)

   전에는 주소를 열면 파일이 내려왔다. 이제 두 가지를 함께 받는다.

     본인 비밀번호   지금 이 자리에 앉은 사람이 그 계정 본인인가
     파일 암호       내려받는 파일 자체를 잠글 열쇠

   앞의 것은 자리를 비운 사이를 답하고, 뒤의 것은 파일이 밖으로 나갔을 때를
   답한다. 다른 물음이므로 다른 값이다.

   ── 암호를 잃으면 그 백업은 영원히 못 연다 ─────────────────────────────────
   뒷문을 두지 않았기 때문이다. 뒷문이 있으면 그 뒷문이 곧 유출 경로가 된다.
   사람이 그것을 모른 채 지나가면 안 되므로 여기서 크게 말하고, 암호를 두 번
   받는다.
--------------------------------------------------------------------------- */

export default function DownloadPanel({ stale, children }: {
  stale: boolean;
  /** 마지막 백업 · 지금 담긴 것. 서버가 셈해 넘긴다 */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const mismatch = p2.length > 0 && p1 !== p2;
  const ready = pin.length > 0 && p1.length >= PASSPHRASE_MIN && p1 === p2;

  async function run() {
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.set('pin', pin);
      fd.set('passphrase', p1);
      const r = await fetch('/api/backup', { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? '백업을 뜨지 못했습니다');
        return;
      }
      const name = (r.headers.get('content-disposition') ?? '')
        .match(/filename="([^"]+)"/)?.[1] ?? 'dhr-backup.dhrbak';
      const blob = await r.blob();

      /* 받은 것을 그대로 저장한다. 서버에도 브라우저에도 남기지 않는다 */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      setDone(name);
      setPin(''); setP1(''); setP2(''); setOpen(false);
    } catch (e) {
      setErr(`보내지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`card flex flex-col p-5 ${stale ? 'border-warn/40 bg-warn-bg' : ''}`}>
      <h3 className="text-[0.875rem] font-bold tracking-tight text-ink">백업 내려받기</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        지금 담긴 것을 통째로 한 파일에 담습니다. 서버에 사본을 두지 않습니다.
      </p>

      {children}

      {done && (
        <p className="mt-4 rounded-md border border-ok/40 bg-ok-bg px-3 py-2 text-xs leading-relaxed text-ink">
          <b>{done}</b> 을 받았습니다. 정한 암호가 없으면 이 파일은 열리지 않습니다.
          암호를 안전한 곳에 따로 적어 두십시오.
        </p>
      )}

      {!open ? (
        <div className="mt-auto pt-5">
          <button onClick={() => { setOpen(true); setDone(''); }} className="btn-primary">
            백업 내려받기
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs leading-relaxed text-body">
            받는 파일에 <b className="text-ink">암호 자물쇠</b>가 걸립니다.
            그 암호는 이 시스템 어디에도 남지 않으므로,{' '}
            <b className="text-ink">잃으면 그 백업은 영원히 열 수 없습니다.</b>
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dl-p1" className="label">파일 암호</label>
              <input id="dl-p1" type="password" value={p1} autoComplete="new-password"
                     onChange={(e) => setP1(e.target.value)}
                     placeholder={`${PASSPHRASE_MIN}자 이상`}
                     className="input mt-1 text-xs" />
            </div>
            <div>
              <label htmlFor="dl-p2" className="label">파일 암호 다시</label>
              <input id="dl-p2" type="password" value={p2} autoComplete="new-password"
                     onChange={(e) => setP2(e.target.value)}
                     className="input mt-1 text-xs" />
              {mismatch && <p className="mt-1 text-xs text-danger">두 값이 다릅니다</p>}
            </div>
            <div>
              <label htmlFor="dl-pin" className="label">본인 비밀번호</label>
              <input id="dl-pin" type="password" inputMode="numeric" value={pin}
                     autoComplete="off" onChange={(e) => setPin(e.target.value)}
                     placeholder="로그인에 쓰는 비밀번호"
                     className="input mt-1 text-xs" />
            </div>
          </div>

          {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

          <div className="mt-4 flex gap-2">
            <button onClick={run} disabled={!ready || busy} className="btn-primary h-10 px-4 text-xs">
              {busy ? '뜨는 중' : '잠가서 내려받기'}
            </button>
            <button onClick={() => { setOpen(false); setErr(''); setPin(''); setP1(''); setP2(''); }}
                    className="btn-ghost h-10 px-4 text-xs">
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
