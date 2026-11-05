import assert from "node:assert/strict";
import { URL } from "node:url";

// Continuity tests create and remove only uniquely named databases on this explicit test server.
export function continuityDatabaseUrl() {
  const value = process.env.RECALLANT_CONTINUITY_DATABASE_URL;
  assert.ok(value, "Set RECALLANT_CONTINUITY_DATABASE_URL to a disposable PostgreSQL server.");
  const target = new URL(value);
  assert.equal(target.hostname, "127.0.0.1", "Continuity tests require a loopback database.");
  assert.equal(target.pathname, "/recallant_continuity_test");
  return value;
}
