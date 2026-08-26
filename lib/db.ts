import { Pool, type PoolClient } from 'pg';
import { pgSsl } from './pgssl';

/* ---------------------------------------------------------------------------
   DB 접근 계층

   원칙 두 가지.

   1) 응용은 반드시 app_role 권한으로 질의한다.
      소유자 권한으로 붙으면 S03의 REVOKE가 통째로 무의미해진다.
      트랜잭션마다 `set local role app_role`을 걸어 구조적으로 강제한다.
      이 모듈을 거치지 않는 질의 경로를 만들지 말 것.

   2) 규칙 판정을 여기서 다시 하지 않는다.
      차단은 DB 계층에 있고(S01~S05, 채번 불변식), 응용은 예외를 받아 그대로
      보여준다. 응용에서 한 번 더 막으면 두 곳이 어긋나는 순간 검증이 깨진다.
--------------------------------------------------------------------------- */

declare global {
  // eslint-disable-next-line no-var
  var __dhrPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__dhrPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL이 설정되지 않았습니다');
    }
    globalThis.__dhrPool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX ?? 4),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      // 원격은 인증서를 검증한다. Supabase 자체 CA는 db/supabase-ca.crt로 준다.
      // 검증을 끄려면 PGSSL_NO_VERIFY=1을 명시적으로 세워야 한다.
      ssl: pgSsl(connectionString),
    });
  }
  return globalThis.__dhrPool;
}

export interface Db {
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  val<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

function wrap(client: PoolClient): Db {
  return {
    async rows(sql, params = []) {
      const r = await client.query(sql, params as never[]);
      return r.rows;
    },
    async one(sql, params = []) {
      const r = await client.query(sql, params as never[]);
      return r.rows[0];
    },
    async val(sql, params = []) {
      const r = await client.query(sql, params as never[]);
      return r.rows[0] ? (Object.values(r.rows[0])[0] as never) : undefined;
    },
  };
}

/**
 * 한 요청의 DB 작업을 하나의 트랜잭션으로 묶는다.
 * actorId는 audit_log.actor_id로 남는다. null이면 "누가"가 비므로 로그인
 * 조회처럼 쓰기가 없는 경로에만 null을 넘길 것.
 */
export async function withActor<T>(
  actorId: string | null,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    await client.query('set local role app_role');
    // 트랜잭션 로컬(3번째 인자 true)로 세팅한다. 커넥션 풀러가 세션을
    // 재사용하므로 세션 GUC로 두면 다음 요청의 감사기록에 남의 id가 찍힌다.
    await client.query('select set_config($1, $2, true)', ['app.user_id', actorId ?? '']);
    const out = await fn(wrap(client));
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------------------------
   예외 해석

   DB가 한글로 던지는 메시지(S03, 채번 불변식, 개발계정 QP 금지 …)는 사람이
   읽으라고 쓴 문장이므로 그대로 올린다. 제약 위반은 SQLSTATE로 분간해
   어느 항목이 문제인지만 붙여 준다.
--------------------------------------------------------------------------- */

interface PgError {
  code?: string;
  message?: string;
  detail?: string;
  column?: string;
  constraint?: string;
}

const CONSTRAINT_LABEL: Record<string, string> = {
  app_user_login_code_key: '이미 쓰이고 있는 로그인 번호입니다',
  numbering_rule_active_uniq:
    '같은 대상·품목에 활성 규칙이 이미 있습니다. 기존 규칙을 내린 뒤 등록하십시오',
  numbering_rule_seq_width_check: '순번 자릿수는 1~10 사이여야 합니다',
  user_role_pkey: '이미 부여된 역할입니다',
};

const COLUMN_LABEL: Record<string, string> = {
  login_code: '로그인 번호',
  full_name: '이름',
  pattern: '패턴',
  effective_from: '시행일',
  target: '채번 대상',
  seq_width: '순번 자릿수',
};

export function dbMessage(e: unknown): string {
  const err = e as PgError;
  const code = err?.code;

  if (code === 'P0001') {
    // raise exception. 사양이 정한 문장이다. 손대지 않는다.
    return err.message ?? '규칙에 의해 거부되었습니다';
  }
  if (code === '42501') {
    return `권한이 없어 거부되었습니다 (S03). ${err.message ?? ''}`.trim();
  }
  if (code === '23505') {
    return CONSTRAINT_LABEL[err.constraint ?? ''] ?? '이미 등록된 값입니다';
  }
  if (code === '23502') {
    const col = COLUMN_LABEL[err.column ?? ''] ?? err.column ?? '필수 항목';
    return `${col}은(는) 비워 둘 수 없습니다`;
  }
  if (code === '23503') {
    return '참조하는 대상이 존재하지 않습니다';
  }
  if (code === '23514') {
    return CONSTRAINT_LABEL[err.constraint ?? ''] ?? '허용 범위를 벗어난 값입니다';
  }
  if (code === '22P02') {
    return '값의 형식이 올바르지 않습니다';
  }
  return err?.message ?? '알 수 없는 오류가 발생했습니다';
}

/** 서버 액션의 공통 반환 형태. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function action(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    return { ok: false, error: dbMessage(e) };
  }
}
