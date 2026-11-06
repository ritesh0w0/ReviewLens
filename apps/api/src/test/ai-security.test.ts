import { describe, it, expect } from "vitest";
import {
  isSensitivePath,
  filterSensitiveFiles,
} from "../ai/security/sensitive-path-filter.js";
import {
  containsPrivateKeyBlock,
  scanAndSanitizeContent,
  sanitizeSecretOccurrencesInProse,
  REDACTED_MARKER,
} from "../ai/security/secret-scanner.js";
import {
  containsDangerousUnicode,
  sanitizeUnicode,
} from "../ai/security/unicode-sanitizer.js";
import { checkPublicRepoGate } from "../ai/security/public-repo-gate.js";

describe("M4 Security Safeguards", () => {
  describe("Sensitive Path Filter", () => {
    it("identifies sensitive configuration and credential files", () => {
      expect(isSensitivePath(".env")).toBe(true);
      expect(isSensitivePath(".env.local")).toBe(true);
      expect(isSensitivePath("config/.env.production")).toBe(true);
      expect(isSensitivePath(".ssh/id_rsa")).toBe(true);
      expect(isSensitivePath("certs/server.key")).toBe(true);
      expect(isSensitivePath("keys/jwt.pem")).toBe(true);
      expect(isSensitivePath("data/app.sqlite")).toBe(true);
      expect(isSensitivePath("secrets/token.json")).toBe(true);
      expect(isSensitivePath("bundle.min.js")).toBe(true);
      expect(isSensitivePath("core.dump")).toBe(true);

      // Package manager and VCS credentials
      expect(isSensitivePath(".npmrc")).toBe(true);
      expect(isSensitivePath("frontend/.npmrc")).toBe(true);
      expect(isSensitivePath(".pypirc")).toBe(true);
      expect(isSensitivePath(".git-credentials")).toBe(true);
      expect(isSensitivePath(".gitconfig")).toBe(true);

      // Cloud and container credentials
      expect(isSensitivePath(".aws/credentials")).toBe(true);
      expect(isSensitivePath(".aws/config")).toBe(true);
      expect(isSensitivePath(".config/gcloud/credentials.db")).toBe(true);
      expect(isSensitivePath(".azure/credentials")).toBe(true);
      expect(isSensitivePath(".kube/config")).toBe(true);
      expect(isSensitivePath(".docker/config.json")).toBe(true);

      // Terraform state & variables
      expect(isSensitivePath("infra/terraform.tfstate")).toBe(true);
      expect(isSensitivePath("infra/terraform.tfstate.backup")).toBe(true);
      expect(isSensitivePath("infra/prod.tfvars")).toBe(true);

      // Binary archives
      expect(isSensitivePath("dump.zip")).toBe(true);
      expect(isSensitivePath("data.tar.gz")).toBe(true);
    });

    it("permits standard non-sensitive code and documentation files", () => {
      expect(isSensitivePath("src/index.ts")).toBe(false);
      expect(isSensitivePath("packages/core/src/rules/engine.ts")).toBe(false);
      expect(isSensitivePath("README.md")).toBe(false);
      expect(isSensitivePath("package.json")).toBe(false);
      expect(isSensitivePath("tsconfig.json")).toBe(false);
      expect(isSensitivePath("docs/decisions/001-arch.md")).toBe(false);
    });

    it("filters list of files and catches previousPath renames from sensitive paths", () => {
      const files = [
        { path: "src/utils.ts" },
        { path: "config/secrets.env" },
        { path: "safe.txt", oldPath: ".ssh/id_ed25519" },
      ];

      const result = filterSensitiveFiles(files);
      expect(result.safe).toHaveLength(1);
      expect(result.safe[0]?.path).toBe("src/utils.ts");
      expect(result.excluded).toHaveLength(2);
      expect(result.excluded[0]?.reason).toContain("sensitive pattern");
      expect(result.excluded[1]?.reason).toContain("Previous file path");
    });
  });

  describe("Secret Scanner", () => {
    it("detects private key blocks and flags for full file exclusion", () => {
      const pem =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----";
      expect(containsPrivateKeyBlock(pem)).toBe(true);

      const result = scanAndSanitizeContent(pem);
      expect(result.action).toBe("exclude_file");
      expect(result.reason).toContain("private key block");
    });

    it("redacts inline GitHub PATs, AWS keys, and Google API keys", () => {
      const raw =
        "const gh = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';\nconst aws = 'AKIAIOSFODNN7EXAMPLE';\nconst g = 'AIzaSyA_12345678901234567890123456789';";

      const result = scanAndSanitizeContent(raw);
      expect(result.action).toBe("keep");
      expect(result.redactedCount).toBe(3);
      expect(result.content).not.toContain("ghp_");
      expect(result.content).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.content).not.toContain("AIzaSyA_");
      expect(result.content).toContain(REDACTED_MARKER);
    });

    it("redacts credentials in database connection strings and authorization headers", () => {
      const raw =
        "const db = 'postgres://admin:superSecret123@db.example.com:5432/main';\nconst header = 'Authorization: Bearer mySecretJwtToken.123.456';";

      const result = scanAndSanitizeContent(raw);
      expect(result.action).toBe("keep");
      expect(result.content).not.toContain("superSecret123");
      expect(result.content).not.toContain("mySecretJwtToken");
      expect(result.content).toContain(
        `postgres://admin:${REDACTED_MARKER}@db.example.com:5432/main`,
      );
      expect(result.content).toContain(
        `Authorization: Bearer ${REDACTED_MARKER}`,
      );
    });

    it("sanitizes secret occurrences in prose (candidate finding messages)", () => {
      const text =
        "Vulnerability found when using token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 to authenticate.";
      const clean = sanitizeSecretOccurrencesInProse(text);
      expect(clean).not.toContain("ghp_");
      expect(clean).toContain(REDACTED_MARKER);
    });
  });

  describe("Unicode Sanitizer (CVE-2021-42574)", () => {
    it("detects and safely visibly escapes Trojan Source Bidi overrides and invisible controls", () => {
      // \u202E is RLO (Right-to-Left Override)
      const attack = "const access = \u202E 'admin' /* check */ \u202C;";
      expect(containsDangerousUnicode(attack)).toBe(true);

      const clean = sanitizeUnicode(attack);
      expect(containsDangerousUnicode(clean)).toBe(false);
      expect(clean).toBe(
        "const access = [U+202E] 'admin' /* check */ [U+202C];",
      );
    });

    it("visibly escapes bidi override controls U+202A to U+202E and U+2066 to U+2069", () => {
      const bidiSamples =
        "\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
      expect(containsDangerousUnicode(bidiSamples)).toBe(true);

      const escaped = sanitizeUnicode(bidiSamples);
      expect(escaped).toBe(
        "[U+202A][U+202B][U+202C][U+202D][U+202E][U+2066][U+2067][U+2068][U+2069]",
      );
    });

    it("visibly escapes Unicode tag characters U+E0000 to U+E007F", () => {
      const tagText = "hidden\u{E0001}\u{E0020}tag";
      expect(containsDangerousUnicode(tagText)).toBe(true);

      const escaped = sanitizeUnicode(tagText);
      expect(escaped).toBe("hidden[U+E0001][U+E0020]tag");
    });

    it("visibly escapes zero-width and invisible control characters U+200B, U+200C, U+200D, U+FEFF, U+2060", () => {
      const zeroWidth = "zero\u200Bwidth\u200Cjoiner\u200Dbyte\uFEFFword\u2060";
      expect(containsDangerousUnicode(zeroWidth)).toBe(true);

      const escaped = sanitizeUnicode(zeroWidth);
      expect(escaped).toBe(
        "zero[U+200B]width[U+200C]joiner[U+200D]byte[U+FEFF]word[U+2060]",
      );
    });

    it("strictly preserves legitimate Unicode: emojis, accented Latin, CJK, Cyrillic, and Greek", () => {
      const legitimate =
        "const msg = '🚀 Launch! Café résumé, 日本語, 中文, Привет мир, α + β = γ';\n\t// newline and tab";
      expect(containsDangerousUnicode(legitimate)).toBe(false);
      expect(sanitizeUnicode(legitimate)).toBe(legitimate);
    });
  });

  describe("Public Repository Gate", () => {
    it("permits confirmed public repositories", () => {
      expect(checkPublicRepoGate({ isPrivate: false }).eligible).toBe(true);
      expect(checkPublicRepoGate({ visibility: "public" }).eligible).toBe(true);
    });

    it("blocks private or internal repositories", () => {
      const priv = checkPublicRepoGate({ isPrivate: true });
      expect(priv.eligible).toBe(false);
      expect(priv.reason).toContain("restricted to public repositories");

      const internal = checkPublicRepoGate({ visibility: "internal" });
      expect(internal.eligible).toBe(false);
      expect(internal.reason).toContain("visibility is 'internal'");
    });
  });
});
