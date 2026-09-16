export interface Author {
  name: string;
  picture_url: string | null;
  picture_alt: string | null;
}

/**
 * What the card lists actually draw. The article body is deliberately absent:
 * a `client:load` island serialises every prop it is handed into the page, so
 * selecting whole rows put each article's HTML into the home page purely to
 * render a title, a date and an excerpt.
 */
export interface StoryCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  date: string;
}

export type PostCard = StoryCard;

export type ExtraCard = StoryCard & { author_name: string | null };

export interface Post extends StoryCard {
  content: string;
  pdf_url: string | null;
}

export interface Extra extends StoryCard {
  content: string;
  author_name: string | null;
}

export interface Puzzle {
  id: string;
  /** Stable URL segment — a puzzle used to be addressed by its list position. */
  slug: string;
  title: string;
  type: "Crossword" | "Find-A-Word" | "Unscramble" | string;
  data: string;
  date: string;
  author_name: string | null;
  cover_image_url: string | null;
  post_id: string | null;
  post_slug?: string | null;
  post_title?: string | null;
}

/** A puzzle without its solution grid — everything a listing renders. */
export type PuzzleSummary = Omit<Puzzle, "data">;

export interface Settings {
  title: string;
  description: string;
  footer_html: string | null;
  og_image_url: string | null;
}

export interface ContactRecipient {
  id: string;
  email: string;
  name: string | null;
}

export interface PageContent {
  title: string;
  body_html: string;
  og_image_url: string | null;
}
