// Data access layer for authentication operations
import { one, exec } from "@yourrank/shared/db";

export async function findUserByEmail(email) {
  return await one("SELECT id FROM users WHERE email=$1", [email]);
}

export async function findUserByCredentials(email) {
  return await one("SELECT id,email,password_hash,password_salt,status FROM users WHERE email=$1", [email]);
}

export async function findSiteByUserId(userId) {
  return await one("SELECT slug FROM sites WHERE user_id=$1", [userId]);
}

export async function findSiteBySlug(slug) {
  return await one("SELECT id FROM sites WHERE slug=$1", [slug]);
}

export async function findUserForReset(email) {
  return await one("SELECT id, email FROM users WHERE email=$1", [email]);
}

export async function findSubscriptionByUserId(userId) {
  return await one("SELECT provider FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [userId]);
}

export async function createUser(tx, userId, email, hash, salt, referralCode) {
  await tx.unsafe(
    "INSERT INTO users (id,email,password_hash,password_salt,plan,status,referral_code) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [userId, email, hash, salt, "free", "active", referralCode]
  );
}

export async function updateUserPassword(userId, hash, salt) {
  await exec("UPDATE users SET password_hash=$1, password_salt=$2, updated_at=now() WHERE id=$3", [hash, salt, userId]);
}

export async function findUserWithTotpSecret(userId) {
  return await one("SELECT totp_secret FROM users WHERE id=$1", [userId]);
}
