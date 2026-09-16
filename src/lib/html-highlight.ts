/**
 * Just enough of an HTML tokenizer to colour the admin panel's HTML fields.
 *
 * This is not a parser and never needs to be: the source is being *edited* here,
 * so it is usually half-written — an unclosed tag, a stray `<` in the middle of
 * a sentence, a quote that has not been closed yet. Everything the scanner does
 * not recognise falls through as plain text, which means a tag someone is
 * halfway through typing still colours what it can and never swallows the rest
 * of the field.
 *
 * The kinds map to the colours in `global.css`, which are Visual Studio Code's
 * own default themes — the editor most of this copy gets written in, so the
 * panel's field looks like the window it was written in.
 */

export type HtmlTokenKind = "text" | "comment" | "tag" | "attr" | "value" | "punct";

export interface HtmlToken {
  text: string;
  kind: HtmlTokenKind;
}

type Push = (text: string, kind: HtmlTokenKind) => void;

/**
 * Colours one tag, `<a href="…">` included: the brackets and `=`, the name, the
 * attribute names, and the quoted values between them.
 */
function pushTag(tag: string, push: Push): void {
  let index = 0;

  const bracket = /^<\/?/.exec(tag);
  if (bracket) {
    push(bracket[0], "punct");
    index = bracket[0].length;
  }

  // The name runs to the first space or `>`; `<!DOCTYPE` is one too.
  const name = /^[^\s/>]+/.exec(tag.slice(index));
  if (name) {
    push(name[0], /^!/.test(name[0]) ? "punct" : "tag");
    index += name[0].length;
  }

  let expectingValue = false;
  while (index < tag.length) {
    const rest = tag.slice(index);

    const space = /^\s+/.exec(rest);
    if (space) {
      push(space[0], "text");
      index += space[0].length;
      continue;
    }
    if (rest.startsWith("/>")) {
      push("/>", "punct");
      index += 2;
      continue;
    }
    if (rest.startsWith(">")) {
      push(">", "punct");
      index += 1;
      continue;
    }
    if (expectingValue) {
      const quote = rest[0];
      if (quote === '"' || quote === "'") {
        const end = rest.indexOf(quote, 1);
        const stop = end < 0 ? rest.length : end + 1;
        push(rest.slice(0, stop), "value");
        index += stop;
      } else {
        const bare = /^[^\s>]+/.exec(rest);
        push(bare ? bare[0] : rest[0], "value");
        index += bare ? bare[0].length : 1;
      }
      expectingValue = false;
      continue;
    }
    if (rest.startsWith("=")) {
      push("=", "punct");
      index += 1;
      expectingValue = true;
      continue;
    }

    const attribute = /^[^\s=/>]+/.exec(rest);
    if (attribute) {
      push(attribute[0], "attr");
      index += attribute[0].length;
      continue;
    }

    // Nothing above matched — a stray character. One at a time, so the scan
    // always moves forward.
    push(rest[0], "text");
    index += 1;
  }
}

export function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let text = "";
  let index = 0;

  const flushText = () => {
    if (text) {
      tokens.push({ text, kind: "text" });
      text = "";
    }
  };

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open < 0) break;

    text += source.slice(index, open);

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      const stop = end < 0 ? source.length : end + 3;
      flushText();
      tokens.push({ text: source.slice(open, stop), kind: "comment" });
      index = stop;
      continue;
    }

    // `<` followed by a letter or `!` opens a tag. Anything else — "5 < 6" in a
    // caption, say — stays text.
    const isTag = /^<\/?[a-zA-Z]|^<![a-zA-Z]/.test(source.slice(open, open + 3));
    if (!isTag) {
      text += "<";
      index = open + 1;
      continue;
    }

    const close = source.indexOf(">", open);
    const stop = close < 0 ? source.length : close + 1;
    flushText();
    pushTag(source.slice(open, stop), (piece, kind) => tokens.push({ text: piece, kind }));
    index = stop;
  }

  flushText();
  if (index < source.length) tokens.push({ text: source.slice(index), kind: "text" });

  return tokens;
}
