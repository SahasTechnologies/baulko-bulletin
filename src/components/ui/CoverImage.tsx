import { croppedCoverUrl } from "@/lib/images";

interface CoverImageProps {
  src: string | null | undefined;
  alt?: string | null;
  priority?: boolean;
}

export default function CoverImage({ src, alt, priority }: CoverImageProps) {
  const url = croppedCoverUrl(src);
  if (!url) {
    return (
      <div
        className="bg-slate-50 dark:bg-neutral-800 rounded-2xl w-full aspect-[2/1]"
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="sm:mx-0">
      <img
        className="w-full aspect-[2/1] object-cover rounded-2xl"
        width={2000}
        height={1000}
        alt={alt || ""}
        src={url}
        loading={priority ? "eager" : "lazy"}
      />
    </div>
  );
}
