import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function key() {
  const source = process.env.ENCRYPTION_KEY;
  if (!source || source.length < 32) {
    throw new Error("ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return crypto.createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) {
    throw new Error("Encrypted value has an invalid format.");
  }
  const decipher = crypto.createDecipheriv(algorithm, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function sha256(content: string | Buffer) {
  return crypto.createHash("sha256").update(content).digest("hex");
}
