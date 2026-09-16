import type { ExtraCard, PostCard } from "@/types/content";
import Icon from "./Icon";
import CoverImage from "./CoverImage";
import DateComponent from "./DateComponent";
import Byline from "./Byline";

function Card({
  href,
  title,
  date,
  excerpt,
  cover,
  alt,
  author,
}: {
  href: string;
  title: string;
  date: string;
  excerpt: string | null;
  cover: string | null;
  alt: string | null;
  author: string;
}) {
  return (
    <article className="snap-start w-[80vw] md:w-[550px] shrink-0">
      <a href={href} className="group mb-5 block w-[80vw] md:w-[550px]">
        <CoverImage src={cover} alt={alt} />
      </a>
      <h3 className="text-balance text-3xl leading-snug tracking-tighter font-bold">
        <a href={href} className="hover:underline">
          {title}
        </a>
      </h3>
      <div className="mb-3 text-lg font-medium opacity-70">
        <DateComponent dateString={date} />
      </div>
      {excerpt && <p className="text-pretty mb-3 text-lg">{excerpt}</p>}
      <Byline name={author} />
    </article>
  );
}

/**
 * One horizontally-scrolling card row: a heading, the cards, and — when the
 * caller says there are more of the same kind of story — a "View More" link
 * to the full listing page (/posts or /extras).
 */
type CardItem = (PostCard | ExtraCard) & { href: string; author: string };

function CardRow({
  heading,
  cards,
  moreHref,
  moreLabel,
}: {
  heading: string;
  cards: CardItem[];
  moreHref: string;
  /** Empty hides the link entirely (e.g. the issues row already shows everything). */
  moreLabel: string;
}) {
  return (
    <>
      <h2 className="mb-8 text-4xl font-bold leading-tight tracking-tighter md:text-5xl">
        {heading}
      </h2>
      <div className="mb-6 md:mb-12 pb-2 flex snap-x snap-mandatory overflow-x-auto gap-x-8 lg:gap-x-10">
        {cards.map((card) => (
          <Card
            key={card.id}
            href={card.href}
            title={card.title}
            date={card.date}
            excerpt={card.excerpt}
            cover={card.cover_image_url}
            alt={card.cover_image_alt}
            author={card.author}
          />
        ))}
        {/* The way on is the next card in the row rather than a link below it:
            the row is where the eye already is, and a reader who has scrolled to
            the end of it finds the link at the end of the scroll.

            It is a card-sized box, not a cover-sized one: the row stretches it
            to the height of the tallest card beside it, so it stands as tall and
            as wide as a card — heading, excerpt and byline included — rather
            than sitting in the corner of the space a card would have taken.

            Nothing about it grows outward on hover. A transform on the box is
            clipped by the row that scrolls it (an overflow on one axis is an
            overflow on both), so the pop is inside: the label and its arrow
            scale up, and the box's own fill and edge come forward. */}
        {moreLabel && (
          <a href={moreHref} className="group flex w-[80vw] shrink-0 snap-start md:w-[550px]">
            <div className="flex w-full flex-1 items-center justify-center rounded-2xl border border-black/10 bg-black/5 transition-colors group-hover:border-black/20 group-hover:bg-black/10 dark:border-white/15 dark:bg-white/5 dark:group-hover:border-white/25 dark:group-hover:bg-white/10">
              <span className="flex flex-col items-center gap-3 text-2xl font-bold transition-transform duration-300 group-hover:scale-105">
                <Icon name="chevron-forward" className="text-4xl transition group-hover:translate-x-1" />
                {moreLabel}
              </span>
            </div>
          </a>
        )}
      </div>
    </>
  );
}

export default function MoreStories({
  posts,
  extras = [],
  heading = "Previous Issues",
  showAllIssuesLink = false,
  showAllExtrasLink = false,
}: {
  posts: PostCard[];
  extras?: ExtraCard[];
  heading?: string;
  /** Link the issues row to /posts, for when this list is truncated. */
  showAllIssuesLink?: boolean;
  /** Link the extras row to /extras, for when this list is truncated. */
  showAllExtrasLink?: boolean;
}) {
  if (!posts.length && !extras.length) return null;

  return (
    <aside>
      {posts.length > 0 && (
        <CardRow
          heading={heading}
          cards={posts.map((post) => ({ ...post, href: `/posts/${post.slug}`, author: "Team Bulletin" }))}
          moreHref="/posts"
          moreLabel={showAllIssuesLink ? "View More Issues" : ""}
        />
      )}
      {extras.length > 0 && (
        <CardRow
          heading="Extras"
          cards={extras.map((extra) => ({
            ...extra,
            href: `/extras/${extra.slug}`,
            author: extra.author_name?.trim() || "Anonymous",
          }))}
          moreHref="/extras"
          moreLabel={showAllExtrasLink ? "View More Extras" : ""}
        />
      )}
    </aside>
  );
}
