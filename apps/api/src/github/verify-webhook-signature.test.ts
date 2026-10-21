import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./verify-webhook-signature.js";

describe("verifyWebhookSignature", () => {
  it("accepts GitHub's published test signature", () => {
    const body = Buffer.from("Hello, World!");

    const signature =
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

    expect(
      verifyWebhookSignature(body, signature, "It's a Secret to Everybody"),
    ).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(
      verifyWebhookSignature(Buffer.from("payload"), undefined, "secret"),
    ).toBe(false);
  });

  it("rejects a malformed signature", () => {
    expect(
      verifyWebhookSignature(Buffer.from("payload"), "sha256=bad", "secret"),
    ).toBe(false);
  });

  it("rejects a body that has changed", () => {
    const signature =
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

    expect(
      verifyWebhookSignature(
        Buffer.from("Hello, world!"),
        signature,
        "It's a Secret to Everybody",
      ),
    ).toBe(false);
  });
});
