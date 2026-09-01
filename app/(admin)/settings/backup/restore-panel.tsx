'use client';

import { useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   백업 파일을 넣어 살펴보고 되돌린다 (사용자 지시 2026-09-01)

   전에는 "파일을 backups/ 에 두고 npm run restore:check 를 돌리십시오" 라고
   안내하고 있었다. 그건 기능이 아니다 - 아무도 그렇게 하지 않는다.

   ── 세 걸음 ────────────────────────────────────────────────────────────────
   ① 파일을 넣는다      서버가 읽어 무엇이 들었는지 말한다. 아무것도 안 쓴다
   ② 나란히 본다        지금 담긴 것과 파일에 담긴 것을 표마다 견준다
   ③ 되돌린다           문턱 둘을 넘어야 단추가 산다

   ── 살펴보기와 되돌리기 사이에 파일을 서버에 두지 않는다 ───────────────────
   같은 파일을 두 번 올린다. 서버에 잠시 두었다가 쓰면 그 사이에 그 파일이
   어디 있는지 아무도 모르는 시간이 생긴다. 이 회사의 기록 전부가 든 파일이다.
--------------------------------------------------------------------------- */

interface DiffRow { table: string; now: number; file: number; keep: boolean }
interface Flaw { table: string; detail: string }

interface Look {
  fileName: string; byteSize: number; sha256: string; takenAt: string;
  database: string; engine: string; migrations: number; totalRows: number;
  flaws: Flaw[]; diff: DiffRow[]; hasFresh: boolean; freshMinutes: number;
}

const kb = (n: number) =>
  n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;

export default function RestorePanel({ canRestore }: { canRestore: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [busy, setBusy] = useState<'' | 'look' | 'run'>('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ rowsBefore: number; rowsAfter: number; ms: number } | null>(null);
  const [typed, setTyped] = useState('');

  async function send(mode: 'inspect' | 'apply') {
    if (!file) return;
    setErr('');
    setBusy(mode === 'inspect' ? 'look' : 'run');
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('mode', mode);
      if (mode === 'apply') fd.set('confirm', typed);
      const r = await fetch('/api/restore', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? '실패했습니다'); return; }
      if (mode === 'inspect') setLook(j);
      else setDone(j);
    } catch (e) {
      setErr(`보내지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  if (done) {
    return (
      <section className="card border-ok/40 bg-ok-bg p-5">
        <h3 className="text-sm font-bold text-ink">되돌렸습니다</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          {done.rowsBefore.toLocaleString('ko-KR')}행이 있던 자리에{' '}
          {done.rowsAfter.toLocaleString('ko-KR')}행이 들어갔습니다.
          걸린 시간 {(done.ms / 1000).toFixed(1)}초.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          계정도 함께 되돌아갔습니다. 지금 로그인이 더 이상 맞지 않을 수 있으니
          한 번 나갔다 들어오십시오. 되돌린 사실은 복구 대장에 남았습니다.
        </p>
        <button onClick={() => window.location.reload()} className="btn-ghost mt-4 h-9 px-3 text-xs">
          화면 새로 고침
        </button>
      </section>
    );
  }

  const bad = (look?.flaws.length ?? 0) > 0;
  const ready = look && !bad && look.hasFresh && typed === look.fileName;

  return (
    <section className="card overflow-hidden">
      <header className="section-head">
        <div className="min-w-0">
          <h3 className="text-[0.875rem] font-bold tracking-tight text-ink">백업 파일 넣기</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            넣으면 무엇이 들었는지 먼저 보여 줍니다. 넣는 것만으로는 아무것도 바뀌지 않습니다.
          </p>
        </div>
      </header>

      <div className="border-b border-line-soft p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".gz,application/gzip"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setLook(null); setErr(''); setTyped('');
            }}
            className="input h-10 max-w-md flex-1 py-1.5 text-xs file:mr-3 file:rounded-md
                       file:border-0 file:bg-canvas-deep file:px-3 file:py-1.5
                       file:text-xs file:font-semibold file:text-ink"
          />
          <button
            onClick={() => send('inspect')}
            disabled={!file || busy !== ''}
            className="btn-ghost h-10 px-4 text-xs"
          >
            {busy === 'look' ? '읽는 중' : '살펴보기'}
          </button>
        </div>
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      </div>

      {look && (
        <>
          <div className="grid gap-x-8 gap-y-3 border-b border-line-soft p-4 sm:grid-cols-3">
            <Field label="뜬 시각" v={look.takenAt.replace('T', ' ')} />
            <Field label="담긴 행" v={`${look.totalRows.toLocaleString('ko-KR')}행`} />
            <Field label="크기" v={kb(look.byteSize)} />
            <Field label="어느 DB" v={look.database} />
            <Field label="이관" v={`${look.migrations}개`} />
            <Field label="지문" v={look.sha256.slice(0, 16)} mono />
          </div>

          {bad ? (
            <div className="border-b border-line-soft bg-danger-bg p-4">
              <p className="text-sm font-semibold text-danger">
                이 파일은 스스로와 맞지 않습니다. 되돌릴 수 없습니다.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-body">
                목록에 적힌 행 수나 내용 해시가 실제 줄과 다릅니다. 보관 중에 상했거나
                손을 탄 파일입니다. 다른 백업을 쓰십시오.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-body">
                {look.flaws.map((f) => (
                  <li key={f.table}>
                    <span className="font-mono">{f.table}</span> · {f.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="border-b border-line-soft px-4 py-2 text-xs text-muted">
              파일이 스스로와 맞습니다. 표 {Object.keys(look.diff).length}개를 아래처럼 갈아 끼웁니다.
            </div>
          )}

          <div className="max-h-80 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th className="th text-left">표</th>
                  <th className="th text-right">지금</th>
                  <th className="th text-right">파일</th>
                  <th className="th text-right">바뀜</th>
                </tr>
              </thead>
              <tbody>
                {look.diff.map((r) => {
                  const d = r.keep ? 0 : r.file - r.now;
                  return (
                    <tr key={r.table} className={d !== 0 && !r.keep ? 'bg-warn-bg/40' : ''}>
                      <td className="td font-mono text-xs">
                        {r.table}
                        {r.keep && <span className="chip ml-2 bg-canvas text-muted">그대로 둠</span>}
                      </td>
                      <td className="td tnum text-right">{r.now.toLocaleString('ko-KR')}</td>
                      <td className="td tnum text-right">
                        {r.keep ? '-' : r.file < 0 ? '없음' : r.file.toLocaleString('ko-KR')}
                      </td>
                      <td className={`td tnum text-right ${d < 0 ? 'text-danger' : d > 0 ? 'text-ok' : 'text-faint'}`}>
                        {r.keep || d === 0 ? '' : d > 0 ? `+${d}` : d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!bad && (
            <div className="border-t border-line bg-danger-bg p-4">
              <p className="text-sm font-bold text-ink">
                되돌리면 지금 있는 기록은 사라집니다. 되돌릴 수 없습니다.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-body">
                제조기록 · 계보 · 감사추적 · 계정까지 파일에 든 것으로 통째로 갈아 끼웁니다.
                한 트랜잭션이라 도중에 실패하면 아무것도 바뀌지 않지만, 끝나고 나면
                되돌릴 방법이 없습니다.
              </p>

              {!look.hasFresh ? (
                <div className="mt-3 rounded-md border border-line bg-surface p-3">
                  <p className="text-sm font-semibold text-ink">
                    먼저 지금 상태를 백업하십시오.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {look.freshMinutes}분 안에 뜬 백업이 없습니다. 되돌릴 길을 만들어 두지
                    않고는 진행할 수 없습니다.
                  </p>
                  <a href="/api/backup" download className="btn-primary mt-3 h-9 px-3 text-xs">
                    지금 백업 내려받기
                  </a>
                </div>
              ) : (
                <div className="mt-3">
                  <label htmlFor="confirm-name" className="label">
                    진행하려면 파일 이름을 그대로 적으십시오
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-body">
                      {look.fileName}
                    </code>
                  </div>
                  <input
                    id="confirm-name"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    placeholder="파일 이름"
                    className="input mt-2 max-w-md font-mono text-xs"
                  />
                </div>
              )}

              <button
                onClick={() => send('apply')}
                disabled={!ready || busy !== '' || !canRestore}
                className="btn-danger mt-4 h-10 px-4 text-xs"
              >
                {busy === 'run' ? '되돌리는 중' : '이 백업으로 되돌린다'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Field({ label, v, mono = false }: { label: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[0.6875rem] font-bold tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm text-ink ${mono ? 'font-mono text-xs' : 'tnum'}`}>{v}</div>
    </div>
  );
}
