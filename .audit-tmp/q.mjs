import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgres://postgres:postgres@localhost:54330/dhr' });
await c.connect();
const sql = process.argv.slice(2).join(' ');
const r = await c.query(sql);
console.log(JSON.stringify(r.rows, null, 1));
await c.end();
