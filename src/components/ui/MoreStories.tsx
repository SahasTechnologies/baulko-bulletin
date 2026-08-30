import type { Extra, Post } from "@/types/content";
import CoverImage from "./CoverImage";
import DateComponent from "./DateComponent";

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
  author?: string | null;
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
      <div className="mb-4 text-lg font-medium opacity-70">
        <DateComponent dateString={date} />
      </div>
      {excerpt && <p className="text-pretty mb-4 text-lg">{excerpt}</p>}
      {author && <p className="text-lg opacity-70">by {author}</p>}
    </article>
  );
}

export default function MoreStories({
  posts,
  extras = [],
  heading = "Previous Issues",
}: {
  posts: Post[];
  extras?: Extra[];
  heading?: string;
}) {
  if (!posts.length && !extras.length) return null;

  return (
    <aside>
      {posts.length > 0 && (
        <>
          <h2 className="mb-8 text-4xl font-bold leading-tight tracking-tighter md:text-5xl">
            {heading}
          </h2>
          <div className="mb-6 md:mb-12 pb-2 flex snap-x snap-mandatory overflow-x-scroll gap-x-8 lg:gap-x-10">
            {posts.map((post) => (
              <Card
                key={post.id}
                href={`/posts/${post.slug}`}
                title={post.title}
                date={post.date}
                excerpt={post.excerpt}
                cover={post.cover_image_url}
                alt={post.cover_image_alt}
              />
            ))}
          </div>
        </>
      )}
      {extras.length > 0 && (
        <>
          <h2 className="mb-8 text-4xl font-bold leading-tight tracking-tighter md:text-5xl">
            Extras
          </h2>
          <div className="mb-6 md:mb-12 pb-4 md:pb-6 flex snap-x snap-mandatory overflow-x-scroll gap-x-8 lg:gap-x-10">
            {extras.map((extra) => (
              <Card
                key={extra.id}
                href={`/extras/${extra.slug}`}
                title={extra.title}
                date={extra.date}
                excerpt={extra.excerpt}
                cover={extra.cover_image_url}
                alt={extra.cover_image_alt}
                author={extra.author_name}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
