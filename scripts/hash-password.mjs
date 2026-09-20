#!/usr/bin/env node
/**
 * Prints the value ADMIN_PASSWORD_HASH wants.
 *
 *   npm run password:hash
 *
 * Type the password at the prompt and press Enter. It is never passed as an
 * argument, so it cannot reach the shell's history or a process listing, and
 * nothing here echoes it back — the encoded hash is all that is printed. This
 * is the form to use in Windows cmd, which has no equivalent of bash's
 * `read -s`.
 *
 * The same works from a pipe, for a script or for a shell where you would
 * rather not answer a prompt:
 *
 *   read -s -p "Password: " PW && printf '%s' "$PW" | npm run password:hash
 *   echo a-long-passphrase| npm run password:hash
 *
 * What it prints is `pbkdf2-sha256.<iterations>.<salt>.<hash>`. The fields are
 * separated by full stops, not the `$` PBKDF2 usually uses, so the value can be
 * pasted into a `.env` file or a shell without `$` expansion quietly eating the
 * salt and the digest — see the note on HASH_SEPARATOR in `src/lib/auth.ts`.
 *
 * The hashing itself lives in `src/lib/auth.ts`, the same module that verifies
 * it, so the two can never disagree about the format. Type stripping is what
 * lets this `.mjs` file import that `.ts` one, exactly as `npm test` does.
 */

import { hashPassword } from "../src/lib/auth.ts";

/** A password is one line. This is where the one being read ends. */
const LINE_BREAK = /\r?\n/;

/**
 * Reads stdin up to the first line break, then stops.
 *
 * Stopping there rather than at end-of-input is what makes the prompt usable by
 * hand: one Enter finishes it. It also means a paste carrying more than one line
 * cannot quietly hash the wrong text.
 */
async function readFirstLine() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    if (chunk.includes(0x0a)) break;
  }
  return Buffer.concat(chunks).toString("utf8").split(LINE_BREAK, 1)[0] ?? "";
}

/**
 * One line from the console, each keystroke shown as `*` — the closest a
 * terminal gets to `read -s`. Raw mode is what does the masking, and it exists
 * only on a TTY: a pipe, a redirect, or a terminal that refuses it reads the
 * ordinary way, where the typing is visible but the line still ends at Enter.
 */
async function readPrompted() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return readFirstLine();

  const restore = () => {
    stdin.setRawMode(false);
    stdin.pause();
  };

  process.stdout.write("Password: ");
  const decoder = new TextDecoder();
  let value = "";

  try {
    stdin.setRawMode(true);
  } catch {
    // A console that refuses raw mode still takes a line the ordinary way; the
    // only difference is that the typing is visible.
    process.stdout.write("\n");
    return readFirstLine();
  }

  stdin.resume();
  try {
    for await (const chunk of stdin) {
      for (const char of decoder.decode(chunk, { stream: true })) {
        const code = char.codePointAt(0);
        if (code === 0x03) {
          // Ctrl+C arrives as data in raw mode rather than as a signal, so put
          // the console back before leaving — a shell handed a terminal still in
          // raw mode is a shell that looks broken.
          process.stdout.write("\n");
          restore();
          process.exit(130);
        }
        if (code === 0x04 || code === 0x1a || code === 0x0d || code === 0x0a) {
          process.stdout.write("\n");
          return value;
        }
        if (code === 0x7f || code === 0x08) {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (code < 0x20) continue; // arrow keys, function keys, the rest
        value += char;
        process.stdout.write("*");
      }
    }
  } finally {
    restore();
  }
  return value;
}

const password = await readPrompted();

if (!password) {
  console.error("No password given. Run it and type one at the prompt:");
  console.error("  npm run password:hash");
  console.error("or pipe one in:");
  console.error('  read -s -p "Password: " PW && printf \'%s\' "$PW" | npm run password:hash');
  process.exit(1);
}

if (password.length < 12) {
  console.error(`Warning: that password is only ${password.length} characters. Twelve or more is the point of hashing it.`);
}

console.log(await hashPassword(password));
