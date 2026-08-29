import type { Author } from "@/types/content";

export default function Avatar({ name, picture_url, picture_alt }: Author) {
  return (
    <div className="flex items-center text-xl">
      {picture_url ? (
        <div className="mr-4 h-12 w-12">
          <img
            alt={picture_alt || ""}
            className="h-full w-full rounded-full object-cover"
            height={48}
            width={48}
            src={picture_url}
          />
        </div>
      ) : (
        <div className="mr-1">By </div>
      )}
      <div className="text-pretty text-xl font-bold">{name}</div>
    </div>
  );
}
