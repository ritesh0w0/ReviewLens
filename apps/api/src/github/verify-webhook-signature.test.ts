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

  it("rejects an incorrect secret", () => {
    const body = Buffer.from("Hello, World!");
    const signature =
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

    expect(verifyWebhookSignature(body, signature, "Wrong Secret")).toBe(false);
  });

  it("accepts an uppercase signature format", () => {
    const body = Buffer.from("Hello, World!");
    const signature =
      "SHA256=757107EA0EB2509FC211221CCE984B8A37570B6D7586C22C46F4379C8B043E17";

    expect(
      verifyWebhookSignature(body, signature, "It's a Secret to Everybody"),
    ).toBe(true);
  });

  it("rejects a bare hex signature without sha256= prefix", () => {
    const body = Buffer.from("Hello, World!");
    const signature =
      "757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

    expect(
      verifyWebhookSignature(body, signature, "It's a Secret to Everybody"),
    ).toBe(false);
  });

  it("correctly verifies an empty buffer payload", () => {
    const emptyBody = Buffer.from("");
    const expectedSig =
      "sha256=a41bc6d81d6413576ae0994995e0ad89a416ec97389515c3604f47722122eeeb";

    expect(verifyWebhookSignature(emptyBody, expectedSig, "test-secret")).toBe(
      true,
    );
  });
});
