// =============================================================================
// harness.mjs - OQ 시험 보조
// 근거: CLAUDE.md §8.1 "테스트 이름에 규칙 번호를 넣으면 출력이 그대로 OQ 각본이 된다"
// =============================================================================

export class Assertion extends Error {}

// 한글은 터미널에서 2칸을 차지한다. 보고서 정렬용.
export function width(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (
      c <= 0x115f ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    )) ? 2 : 1;
  }
  return w;
}

export function pad(s, n) {
  const d = n - width(s);
  return String(s) + ' '.repeat(d > 0 ? d : 0);
}

export function makeCtx(db, fx) {
  let seq = 0;

  const ctx = {
    db,
    fx,

    // ---- 픽스처 ------------------------------------------------------------
    // login_code는 숫자 문자열이다 (§4.1 "패드 로그인").
    async newUser(opts = {}) {
      seq += 1;
      const r = await db.query(
        `insert into app_user (login_code, full_name, pin_hash, is_developer, can_login)
         values ($1,$2,$3,$4,$5) returning id`,
        [opts.login_code ?? `9${String(seq).padStart(4, '0')}`,
         opts.full_name   ?? `시험계정${seq}`,
         // QP는 pin_hash가 null이다. 명시적 null을 기본값으로 덮으면 안 된다.
         'pin_hash' in opts ? opts.pin_hash : '$argon2id$test$',
         opts.is_developer ?? false,
         opts.can_login    ?? true]);
      return r[0].id;
    },

    // ---- 질의 --------------------------------------------------------------
    rows: (text, params = []) => db.query(text, params),

    one: async (text, params = []) => (await db.query(text, params))[0],

    val: async (text, params = []) => {
      const r = await db.query(text, params);
      return r.length ? Object.values(r[0])[0] : undefined;
    },

    exec: (text) => db.exec(text),

    // ---- 역할 전환 ---------------------------------------------------------
    // app_role로 내려가 권한 검사를 실제로 받게 한다. 소유자로 실행하면
    // REVOKE가 무의미해져 S03 시험이 통째로 거짓 통과한다.
    async asRole(role, fn) {
      await db.exec(`set role ${role}`);
      try { return await fn(); }
      finally { await db.exec('reset role'); }
    },

    // ---- 단언 --------------------------------------------------------------
    // 거부를 기대한다. code는 SQLSTATE (42501 권한거부 / P0001 raise
    // exception / 23505 unique / 23502 not null / 23503 FK).
    async rejects(fn, { code, message } = {}) {
      let err = null;
      try { await fn(); }
      catch (e) { err = e; }
      if (!err) throw new Assertion('거부되어야 하는데 통과했다');
      if (code) {
        const codes = Array.isArray(code) ? code : [code];
        if (!codes.includes(err.code)) {
          throw new Assertion(
            `SQLSTATE ${codes.join('/')} 를 기대했으나 ${err.code} (${err.message})`);
        }
      }
      if (message && !String(err.message).includes(message)) {
        throw new Assertion(`메시지에 "${message}" 를 기대했으나 "${err.message}"`);
      }
      return err;
    },

    async resolves(fn) {
      try { return await fn(); }
      catch (e) { throw new Assertion(`통과해야 하는데 거부됐다: ${e.message}`); }
    },

    eq(actual, expected, label) {
      const a = JSON.stringify(actual), b = JSON.stringify(expected);
      if (a !== b) throw new Assertion(`${label}: ${b} 를 기대했으나 ${a}`);
    },

    ok(cond, label) {
      if (!cond) throw new Assertion(label);
    },

    // ---- 세션 사용자 -------------------------------------------------------
    setActor: (id) => db.query('select set_config($1, $2, false)',
                               ['app.user_id', id ?? '']),
  };
  return ctx;
}
