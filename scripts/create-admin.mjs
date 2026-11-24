// Creates the platform admin account (you), or resets its password if it exists.
// Usage: npm run create-admin -- you@example.com "Your Name"
// The password is asked for interactively, so it never lands in shell history.
//
// Writes the same rows Better Auth's own sign-up would (users + a "credential"
// account holding the password hash), plus a platform_admins row, in one
// transaction. Public sign-up is disabled, so this is the only way in.
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim();
if (!email || !name) {
  console.error('Usage: npm run create-admin -- you@example.com "Your Name"');
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
const password = await rl.question("Password (min 10 characters): ");
rl.close();
if (password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();
try {
  await client.query("BEGIN");

  const existing = await client.query(
    "select id from users where lower(email) = lower($1)",
    [email],
  );
  let userId = existing.rows[0]?.id;

  if (!userId) {
    const user = await client.query(
      "insert into users (name, email, email_verified) values ($1, lower($2), true) returning id",
      [name, email],
    );
    userId = user.rows[0].id;
    await client.query(
      // account_id is text, user_id is uuid: separate parameters, or Postgres
      // cannot infer one type for both.
      "insert into accounts (account_id, provider_id, user_id, password) values ($1, 'credential', $2, $3)",
      [String(userId), userId, await hashPassword(password)],
    );
    console.log(`Created user ${email}`);
  } else {
    // Re-running resets the password: this is the recovery path until the app
    // has its own password-reset flow.
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
    // Sign out every existing session, so an old password's sessions die with it.
    await client.query("delete from sessions where user_id = $1", [userId]);
    console.log(`User ${email} already existed; password reset`);
  }

  await client.query(
    "insert into platform_admins (user_id) values ($1) on conflict (user_id) do nothing",
    [userId],
  );
  await client.query("COMMIT");
  console.log("Platform admin: yes");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
