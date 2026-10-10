// 앱 테이블 5개를 DB 에 만든다(CREATE ... IF NOT EXISTS, 여러 번 돌려도 안전).
// 사용: pnpm db:app  — .env.local 의 TURSO_DATABASE_URL·TURSO_AUTH_TOKEN 을 읽는다.
// 이미 환경변수로 준 값이 우선(예: TURSO_DATABASE_URL=file:./data/dev.db pnpm db:app).
import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DDL } from "../src/db/app-ddl";

// pnpm 은 패키지 폴더에서 스크립트를 돌린다. tsx 는 CJS 로 바꾸므로 import.meta·최상위 await 를 쓰지 않는다.
const root = process.cwd();

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

async function main(): Promise<void> {
  const fileEnv = readEnvFile(resolve(root, ".env.local"));
  const url = process.env.TURSO_DATABASE_URL ?? fileEnv.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN ?? fileEnv.TURSO_AUTH_TOKEN;
  if (!url) {
    console.error("TURSO_DATABASE_URL 이 없습니다(.env.local 또는 환경변수).");
    process.exit(1);
}

const client = url.startsWith("file:") ? createClient({ url }) : createClient({ url, authToken });
// 주소는 호스트까지만 보여 준다(토큰·경로 쿼리는 찍지 않는다).
console.log(`대상: ${url.startsWith("file:") ? url : url.replace(/^([a-z]+:\/\/[^/?#]+).*$/i, "$1")}`);

for (const stmt of APP_DDL) await client.execute(stmt);

const rs = await client.execute(
  "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name",
);
for (const r of rs.rows) console.log(`${r.type}\t${r.name}`);
client.close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
