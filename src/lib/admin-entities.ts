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
  | "author_name"
  | "post_id";

export interface FieldDef {
  name: FieldName;
  label: string;
  /**
   * `image` and `pdf` render an uploader (with a crop step for images) that
   * sends the file straight to ImageKit and stores the resulting URL.
   * `issue` renders a picker of existing issues.
   */
  type: "text" | "textarea" | "date" | "select" | "url" | "image" | "pdf" | "issue";
  required?: boolean;
  placeholder?: string;
  rows?: number;
  options?: string[];
  help?: string;
  maxLength?: number;
  /** Renders full width in the two-column form grid. */
  full?: boolean;
  /**
   * Body copy: the field also gets an uploader that inserts a `<figure>` into
   * the text at the cursor, so an illustrated piece can be written entirely in
   * the panel rather than needing picture URLs pasted in by hand.
   */
  allowImages?: boolean;
}

export interface ListColumn {
  label: string;
  field: "title" | "slug" | "date" | "type" | "author_name";
}

export interface EntityDef {
  key: EntityKey;
  singular: string;
  plural: string;
  /** Public URL of a saved row, for the "view" link. */
  publicHref: (row: ContentRow) => string | null;
  columns: ListColumn[];
  fields: FieldDef[];
}

/** Every admin row is a flat map of column → text; `id` is always present. */
export type ContentRow = Record<string, string | null> & { id: string };

const posts: EntityDef = {
  key: "posts",
  singular: "Issue",
  plural: "Issues",
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
      label: "Issue PDF",
      type: "pdf",
      help: "Uploaded straight to ImageKit at bulletin/pdfs. The issue is read in the viewer, so this is what readers see.",
    },
    {
      name: "cover_image_url",
      label: "Cover image",
      type: "image",
      help: "Upload and crop to the 2:1 shape the site displays. Leave the crop at Cover 2:1 for the standard look.",
    },
    { name: "cover_image_alt", label: "Cover image alt text", type: "text", help: "Describes the cover for screen readers." },
    {
      name: "content",
      label: "Content (HTML)",
      type: "textarea",
      rows: 8,
      full: true,
      allowImages: true,
      help: "Only needed when there is no PDF. HTML, not Markdown — paragraphs, headings, links and lists all work. Use “Add a picture to the text” to upload art into the body.",
    },
  ],
};

const extras: EntityDef = {
  key: "extras",
  singular: "Extra",
  plural: "Extras",
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
    {
      name: "cover_image_url",
      label: "Cover image",
      type: "image",
      help: "Upload and crop. The site shows it at 2:1, and the article column is centre-aligned beneath it.",
    },
    { name: "cover_image_alt", label: "Cover image alt text", type: "text" },
    {
      name: "content",
      label: "Content (HTML)",
      type: "textarea",
      rows: 12,
      full: true,
      allowImages: true,
      help: "HTML, not Markdown — paragraphs, headings, links and lists all work. Use “Add a picture to the text” to upload art into the body, captioned or not.",
    },
  ],
};

const puzzles: EntityDef = {
  key: "puzzles",
  singular: "Puzzle",
  plural: "Puzzles",
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
      help: "Must match the data below — it decides which interactive component renders.",
    },
    { name: "date", label: "Publication date", type: "date", required: true, help: "Shown in Sydney time." },
    { name: "author_name", label: "Author", type: "text", help: "Blank shows “Anonymous”." },
    {
      name: "post_id",
      label: "Issue this puzzle belongs to",
      type: "issue",
      help: "Linked puzzles are listed at the foot of that issue's page. Leave blank for a standalone puzzle.",
    },
    {
      name: "cover_image_url",
      label: "Cover image",
      type: "image",
      help: "Optional art for the puzzle tile. Square (1:1) reads best — the tiles are square.",
    },
    {
      name: "data",
      label: "Puzzle",
      type: "textarea",
      rows: 14,
      required: true,
      full: true,
      help: "Built with the fields below; the format is generated for you.",
    },
  ],
};

export const ENTITIES: Record<EntityKey, EntityDef> = { posts, extras, puzzles };

export function isEntityKey(value: string | undefined): value is EntityKey {
  return value === "posts" || value === "extras" || value === "puzzles";
}
