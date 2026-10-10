import { APP_DDL } from "./app-ddl";
import { client } from "./client";

let ready: Promise<void> | null = null;

/**
 * 앱 테이블 5개를 `CREATE TABLE IF NOT EXISTS` 로 만든다. 프로세스당 1회(memoized).
 * 실패하면 memo 를 비워 다음 요청이 다시 시도한다. 콜드 스타트마다 왕복 10번이 되지 않게 batch 한 번으로 보낸다.
 */
export function ensureAppTables(): Promise<void> {
  if (ready) return ready;
  const p = runDdl();
  ready = p;
  p.catch(() => {
    if (ready === p) ready = null;
  });
  return p;
}

async function runDdl(): Promise<void> {
  await client.batch(APP_DDL.map((sql) => ({ sql, args: [] })), "write");
}
