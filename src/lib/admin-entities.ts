/**
 * Declarative description of the editable content types.
 *
 * The admin list/editor pages and the write API are generic — they render and
 * validate whatever is declared here, so adding a column to a table means
 * adding a field below rather than touching three pages and a route.
 *
 * `help` strings are the only documentation an editor gets, so they name the
 * exact format the public components parse.
 */

export type EntityKey = "posts" | "extras" | "puzzles";

export type FieldName =
  | "title"
  | "slug"
  | "date"
  | "excerpt"
  | "content"
  | "cover_image_url"
  | "cover_image_alt"
  | "pdf_url"
  | "type"
  | "data"
  | "author_name";

export interface FieldDef {
  name: FieldName;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "url";
  required?: boolean;
  placeholder?: string;
  rows?: number;
  options?: string[];
  help?: string;
  maxLength?: number;
  /** Renders full width in the two-column form grid. */
  full?: boolean;
}

export interface ListColumn {
  label: string;
  field: "title" | "slug" | "date" | "type" | "author_name";
}

export interface EntityDef {
  key: EntityKey;
  singular: string;
  plural: string;
  blurb: string;
  /** Public URL of a saved row, for the "view" link. */
  publicHref: (row: ContentRow) => string | null;
  columns: ListColumn[];
  fields: FieldDef[];
}

/** Every admin row is a flat map of column → text; `id` is always present. */
export type ContentRow = Record<string, string | null> & { id: string };

const PUZZLE_FORMATS = [
  "Crossword — one word per line: x y direction word clue, where x and y are 0-based grid positions. Example: 11 0 down aliens non human beings who travel in advanced technology",
  "Find-A-Word — the grid rows (space-separated letters), a completely blank line, then the hidden words one per line.",
  "Unscramble — one per line: Scrambled Answer. Example: EPPAL APPLE",
].join("\n\n");

const posts: EntityDef = {
  key: "posts",
  singular: "Issue",
  plural: "Issues",
  blurb: "Full issues, shown as the latest issue on the home page and under Previous Issues.",
  publicHref: (row) => (row.slug ? `/posts/${row.slug}` : null),
  columns: [
    { label: "Title", field: "title" },
    { label: "Slug", field: "slug" },
    { label: "Published", field: "date" },
  ],
  fields: [
    { name: "title", label: "Title", type: "text", required: true, placeholder: "n+33: Winter Edition" },
    {
      name: "slug",
      label: "Slug",
      type: "text",
      placeholder: "n-33",
      help: "The URL becomes /posts/<slug>. Leave blank to derive it from the title.",
    },
    { name: "date", label: "Publication date", type: "date", required: true, help: "Shown in Sydney time." },
    { name: "excerpt", label: "Excerpt", type: "textarea", rows: 3, help: "Short summary used on cards and previews." },
    {
      name: "pdf_url",
      label: "PDF URL",
      type: "url",
      placeholder: "https://ik.imagekit.io/sahas/bulletin/pdfs/n_33.pdf",
      help: "Upload the PDF to ImageKit first (bulletin/pdfs), then paste the URL. With a PDF set, the issue is read in the viewer; without one, Content is shown instead.",
    },
    { name: "cover_image_url", label: "Cover image URL", type: "url", placeholder: "https://ik.imagekit.io/…" },
    { name: "cover_image_alt", label: "Cover image alt text", type: "text", help: "Describes the cover for screen readers." },
    {
      name: "content",
      label: "Content (HTML)",
      type: "textarea",
      rows: 8,
      full: true,
      help: "HTML, not Markdown — e.g. <p>Read the issue here.</p>. Only displayed when no PDF URL is set.",
    },
  ],
};

const extras: EntityDef = {
  key: "extras",
  singular: "Extra",
  plural: "Extras",
  blurb: "Standalone stories, poetry and illustrations outside a numbered issue.",
  publicHref: (row) => (row.slug ? `/extras/${row.slug}` : null),
  columns: [
    { label: "Title", field: "title" },
    { label: "Slug", field: "slug" },
    { label: "Author", field: "author_name" },
    { label: "Published", field: "date" },
  ],
  fields: [
    { name: "title", label: "Title", type: "text", required: true },
    {
      name: "slug",
      label: "Slug",
      type: "text",
      help: "The URL becomes /extras/<slug>. Leave blank to derive it from the title.",
    },
    { name: "date", label: "Publication date", type: "date", required: true, help: "Shown in Sydney time." },
    {
      name: "author_name",
      label: "Author",
      type: "text",
      help: "Matched against existing authors, otherwise a new author is created. Blank shows “Anonymous”.",
    },
    { name: "excerpt", label: "Excerpt", type: "textarea", rows: 3 },
    { name: "cover_image_url", label: "Cover image URL", type: "url" },
    { name: "cover_image_alt", label: "Cover image alt text", type: "text" },
    {
      name: "content",
      label: "Content (HTML)",
      type: "textarea",
      rows: 12,
      full: true,
      help: "HTML, not Markdown — paragraphs, headings, links and images all work.",
    },
  ],
};

const puzzles: EntityDef = {
  key: "puzzles",
  singular: "Puzzle",
  plural: "Puzzles",
  blurb: "Interactive crosswords, find-a-words and unscrambles, listed newest first.",
  publicHref: () => "/puzzles",
  columns: [
    { label: "Title", field: "title" },
    { label: "Type", field: "type" },
    { label: "Author", field: "author_name" },
    { label: "Published", field: "date" },
  ],
  fields: [
    { name: "title", label: "Title", type: "text", required: true, placeholder: "East Asian Culture III" },
    {
      name: "type",
      label: "Puzzle type",
      type: "select",
      required: true,
      options: ["Crossword", "Find-A-Word", "Unscramble"],
      help: "Must match the data format below — it decides which interactive component renders.",
    },
    { name: "date", label: "Publication date", type: "date", required: true, help: "Shown in Sydney time." },
    { name: "author_name", label: "Author", type: "text", help: "Blank shows “Anonymous”." },
    { name: "cover_image_url", label: "Cover image URL", type: "url", help: "Optional art for the puzzle tile." },
    {
      name: "data",
      label: "Puzzle data",
      type: "textarea",
      rows: 14,
      required: true,
      full: true,
      help: PUZZLE_FORMATS,
    },
  ],
};

export const ENTITIES: Record<EntityKey, EntityDef> = { posts, extras, puzzles };

export function isEntityKey(value: string | undefined): value is EntityKey {
  return value === "posts" || value === "extras" || value === "puzzles";
}
