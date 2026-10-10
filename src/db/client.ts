import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL 이 설정되지 않았습니다. 로컬은 file:./data/fixture.db, 배포는 libsql:// 주소와 TURSO_AUTH_TOKEN 을 지정하세요.",
    );
  }
  if (url.startsWith("file:")) return createClient({ url });
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

export const db = drizzle(makeClient());
