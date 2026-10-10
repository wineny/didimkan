import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

function makeClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL 이 설정되지 않았습니다. 로컬은 file:./data/fixture.db, 배포는 libsql:// 주소와 TURSO_AUTH_TOKEN 을 지정하세요.",
    );
  }
  if (url.startsWith("file:")) return createClient({ url });
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

/** libsql 클라이언트(앱 테이블 DDL 용). `db` 와 같은 연결을 쓴다. */
export const client = makeClient();
export const db = drizzle(client);
