export interface Author {
  name: string;
  picture_url: string | null;
  picture_alt: string | null;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  date: string;
  pdf_url: string | null;
}

export interface Extra {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  date: string;
  author_name: string | null;
}

export interface Puzzle {
  id: string;
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
