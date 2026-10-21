import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();

  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
