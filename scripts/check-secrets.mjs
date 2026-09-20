#!/usr/bin/env node
/**
 * Scans the tree for anything that looks like a live credential.
 *
 *   node scripts/check-secrets.mjs
 *
 * GitHub can scan a repository's history for secrets, but that is a repository
 * *setting* rather than something this codebase carries with it — it cannot be
 * reviewed, it cannot be run before a push, and it cannot guard a fork or a
 * self-hosted checkout. This is the part that travels with the code: one file,
 * no dependencies, no network, and the same answer in CI as on a laptop.
 *
 * It is a net, not a lock. It looks for the shapes this project's services
 * actually hand out, and for a secret pasted into the one file that is most
 * often committed by accident — a `.env`. A key that is live today and shaped
 * like none of these will still sail through, which is why the deploy should
 * hold its secrets in the platform's environment variables rather than here.
 *
 * Files that are *expected* to contain placeholder text — this README, the
 * example env file, the tests — are handled by the placeholder rules below
 * rather than by being skipped, so a real key in one of them is still caught.
 *
 * What it does not read is anything git ignores. A developer's own `.env` is
 * exactly where a live key is supposed to be, and a check that fires on the one
 * correctly-kept file would be turned off within a week. The list of files to
 * read comes from git itself, so `.gitignore` is what decides — the same rule
 * that decides what gets committed.
 */
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories that are generated, vendored, or not ours to scan. */
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".astro",
  ".vercel",
  ".probe",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

/** Vendored copies of a third-party library, minus the library. */
const SKIP_PATHS = [path.join("public", "pdfjs")];

/**
 * Generated files that are nothing but hashes and resolved URLs. Scanning them
 * finds base64 fragments that look like keys and never are.
 */
const SKIP_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

/** Text only: a credentials scanner reading a PNG is how false positives start. */
const SCANNED_EXTENSIONS = new Set([
  ".astro",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

/**
 * Values that mean "put something here", not "this is the something". Checked
 * against the matched text, case-insensitively, before a match is reported.
 */
const PLACEHOLDERS = [
  "your",
  "example",
  "placeholder",
  "changeme",
  "change-me",
  "redacted",
  "dummy",
  "sample",
  "fake",
  "test",
  "xxx",
  "<",
  ">",
  "...",
  "${",
  "$(",
  "process.env",
  "import.meta",
];

const PATTERNS = [
  {
    name: "private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  { name: "Resend API key", regex: /\bre_[A-Za-z0-9]{16,}\b/g },
  { name: "ImageKit private key", regex: /\bprivate_[A-Za-z0-9+/=_-]{16,}/g },
  {
    // Anchored to where a value starts, so a `0x…` fragment inside an integrity
    // hash is not mistaken for one.
    name: "Turnstile secret key",
    regex: /(?:^|[\s"'=(,\[])(0x[0-9A-Za-z_-]{30,})\b/g,
  },
  {
    name: "ImageKit upload signature",
    regex: /\bsignature['"]?\s*[:=]\s*['"][0-9a-f]{40,}['"]/gi,
  },
  {
    // A connection string that carries a password. `user:password@` and the
    // other obvious placeholders are filtered out below.
    name: "connection string with a password",
    regex: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{4,}@/g,
  },
  {
    // The one assignment that is worth flagging on sight: a long, random-looking
    // value given to a name that is a secret in this project.
    name: "secret assigned a literal value",
    regex:
      /\b(?:ADMIN_PASSWORD|ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET|DATABASE_URL|RESEND_API_KEY|RESEND_EMAIL_FROM|IMAGEKIT_PRIVATE_KEY|IMAGEKIT_PUBLIC_KEY|TURNSTILE_SECRET_KEY)['"]?\s*[:=]\s*['"]?([A-Za-z0-9+/_=-]{24,})['"]?/g,
  },
];

/** A committed `.env` is a finding in its own right, whatever is in it. */
function isEnvironmentFile(name) {
  if (!name.startsWith(".env")) return false;
  return !/\.(example|template|sample)$/.test(name);
}

function placeholder(text) {
  const lower = text.toLowerCase();
  return PLACEHOLDERS.some((marker) => lower.includes(marker));
}

/**
 * Every file worth reading, as paths relative to the root.
 *
 * Git answers this whenever it can: tracked files plus the untracked ones that
 * are not ignored. That is the list that matters — it is the list that would be
 * pushed. Without git (a tarball, a stripped CI checkout) the same set is
 * approximated by walking the tree and skipping what is generated.
 */
async function listFiles() {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
    );
    return stdout.split("\0").filter(Boolean);
  } catch {
    return walk(ROOT);
  }
}

async function walk(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(ROOT, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (SKIP_PATHS.some((skip) => relative.startsWith(skip))) continue;
      files.push(...(await walk(full)));
      continue;
    }
    if (SKIP_PATHS.some((skip) => relative.startsWith(skip))) continue;
    files.push(relative);
  }
  return files;
}

/** Enough of a match to find it, not enough to leak it into a CI log. */
function redact(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)} (${trimmed.length} chars)`;
}

const findings = [];

for (const listed of await listFiles()) {
  const relative = listed.split(path.sep).join("/");
  const name = path.basename(relative);
  const file = path.join(ROOT, relative);

  if (SKIP_DIRECTORIES.has(relative.split("/")[0])) continue;
  if (SKIP_FILES.has(name)) continue;
  if (SKIP_PATHS.some((skip) => relative.startsWith(skip.split(path.sep).join("/")))) continue;
  const extension = path.extname(name).toLowerCase();
  const isEnv = name.startsWith(".env");
  if (!isEnv && !SCANNED_EXTENSIONS.has(extension)) continue;

  if (isEnvironmentFile(name)) {
    findings.push({ file: relative, line: 0, what: "a committed .env file" });
  }

  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    continue;
  }
  // Cheap gate: a file with none of these characters cannot hold a key.
  if (!/[-_=A-Za-z0-9]{16,}/.test(contents)) continue;

  const lines = contents.split(/\r?\n/);
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const text = match[1] ?? match[0];
        if (placeholder(match[0]) || placeholder(text)) continue;
        findings.push({
          file: relative,
          line: index + 1,
          what: `${pattern.name}: ${redact(text)}`,
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log("No credentials found.");
  process.exit(0);
}

console.error(`Found ${findings.length} thing${findings.length === 1 ? "" : "s"} that look like a credential:\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.what}`);
}
console.error(
  [
    "",
    "If one of these is live: rotate it first, then remove it. Anything that has",
    "been committed is in the history and in every clone, so deleting the line is",
    "not enough on its own.",
  ].join("\n")
);
process.exit(1);
