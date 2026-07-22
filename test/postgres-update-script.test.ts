import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("PostgreSQL backups en migraties gebruiken uitsluitend de migratorrol", async () => {
  const script = await readFile(path.join(process.cwd(), "update.sh"), "utf8");
  assert.match(script, /pg_dump -Fc --file="\$dump_file" "\$POSTGRES_MIGRATION_URL"/);
  assert.match(script, /env DATABASE_URL="\$POSTGRES_MIGRATION_URL" CHECKPOINT_DISABLE=1 pnpm prisma migrate deploy/);
  assert.doesNotMatch(script, /pg_dump -Fc --file="\$dump_file" "\$DATABASE_URL"/);
  assert.match(script, /SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user/);
  assert.match(script, /MIGRATOR_BYPASSRLS.*= "t"/s);
});
