interface CoverImageProps {
  src: string | null | undefined;
  alt?: string | null;
  priority?: boolean;
}

export default function CoverImage({ src, alt, priority }: CoverImageProps) {
  if (!src) {
    return <div className="bg-slate-50 rounded-2xl" style={{ paddingTop: "50%" }} />;
  }

  return (
    <div className="sm:mx-0">
      <img
        className="h-auto w-full rounded-2xl"
        width={2000}
        height={1000}
        alt={alt || ""}
        src={src}
        loading={priority ? "eager" : "lazy"}
      />
    </div>
  );
}
