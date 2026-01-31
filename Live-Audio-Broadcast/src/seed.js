import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { users } from './db/schema.js';
import { env } from './config/env.js';
import { hashPassword } from './utils/hash.js';

async function seedSuperAdmin() {
  const email = env.SEED_SUPER_ADMIN_EMAIL ?? 'superadmin@example.com';
  const password = env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await hashPassword(password);

  const [existingUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    await db
      .update(users)
      .set({ role: 'super_admin', passwordHash, updatedAt: new Date() })
      .where(eq(users.id, existingUser.id));

    console.log(` Updated super_admin: ${email}`);
    return;
  }

  await db.insert(users).values({
    email,
    passwordHash,
    role: 'super_admin',
    isVerified: true,
  });

  console.log(`Created super_admin: ${email}`);
}

seedSuperAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Seed failed:', err);
    process.exit(1);
  });
