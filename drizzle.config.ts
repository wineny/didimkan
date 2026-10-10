import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // 강좌 계약 4개만 관리한다. 앱 테이블(users 등)은 src/db/app-ddl.ts 가 만든다.
  tablesFilter: ["courses", "institutions", "enrollment_patterns", "meta"],
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./data/didimkan.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
