// 개발용 즉석 조회. 운영 자료에 쓰지 않는다.
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();
const r = await c.query(process.argv[2]);
console.table(r.rows);
await c.end();
