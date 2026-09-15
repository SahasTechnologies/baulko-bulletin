import Icon from "@/components/ui/Icon";

export default function Byline({ name }: { name: string }) {
  const isTeam = name.trim().toLowerCase() === "team bulletin";

  return (
    <div className="flex items-center gap-2 text-xl font-bold">
      {isTeam ? (
        <img
          alt=""
          className="size-7 shrink-0 object-contain"
          height={850}
          width={850}
          src="/bulletin.png"
        />
      ) : (
        <Icon name="person-circle" />
      )}
      <span>{name}</span>
    </div>
  );
}
