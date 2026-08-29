import type { Post } from "@/types/content";
import CoverImage from "./CoverImage";
import DateComponent from "./DateComponent";

export default function MoreStories({ posts }: { posts: Post[] }) {
  if (!posts.length) return null;

  return (
    <section>
      <h2 className="mb-8 text-4xl font-bold leading-tight tracking-tighter md:text-5xl">
        More Issues
      </h2>
      <div className="mb-32 grid grid-cols-1 gap-y-20 md:grid-cols-2 md:gap-x-16 md:gap-y-32 lg:gap-x-32">
        {posts.map((post) => (
          <article key={post.id}>
            <a className="group mb-5 block" href={`/posts/${post.slug}`}>
              <CoverImage src={post.cover_image_url} alt={post.cover_image_alt} />
            </a>
            <h3 className="mb-3 text-3xl font-bold leading-snug">
              <a href={`/posts/${post.slug}`} className="hover:underline">
                {post.title}
              </a>
            </h3>
            <div className="mb-4 text-lg opacity-70">
              <DateComponent dateString={post.date} />
            </div>
            {post.excerpt && (
              <p className="mb-4 text-lg leading-relaxed">{post.excerpt}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
