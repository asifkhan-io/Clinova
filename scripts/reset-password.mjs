// Resets the password of an EXISTING account (an owner or staff member who is
// locked out) without changing anything else — unlike create-admin, it never
// grants platform-admin. All their sessions are signed out.
// Usage: npm run reset-password -- someone@example.com
// The password is asked for interactively, so it never lands in shell history.
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run reset-password -- someone@example.com");
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
const password = await rl.question("New password (min 10 characters): ");
rl.close();
if (password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();
try {
  await client.query("BEGIN");
  const user = await client.query("select id from users where lower(email) = $1", [email]);
  const userId = user.rows[0]?.id;
  if (!userId) {
    console.error(`No account for ${email}.`);
    await client.query("ROLLBACK");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  const updated = await client.query(
    "update accounts set password = $2, updated_at = now() where user_id = $1 and provider_id = 'credential'",
    [userId, hash],
  );
  if (updated.rowCount === 0) {
    await client.query(
      "insert into accounts (account_id, provider_id, user_id, password) values ($1, 'credential', $2, $3)",
      [String(userId), userId, hash],
    );
  }
  await client.query("delete from sessions where user_id = $1", [userId]);
  await client.query("COMMIT");
  console.log(`Password reset for ${email}. All their sessions were signed out.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
