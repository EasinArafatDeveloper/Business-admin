import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts stored credentials (e.g. SMTP passwords) with AES-256-GCM.
 * Key: SECRETS_KEY (64 hex chars). Falls back to a key derived from SESSION_SECRET.
 */
function key() {
  const hex = process.env.SECRETS_KEY ?? "";
  if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  const session = process.env.SESSION_SECRET;
  if (!session) throw new Error("SECRETS_KEY (or SESSION_SECRET) is not set");
  return createHash("sha256").update(`scaleup-secrets:${session}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(stored: string) {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
