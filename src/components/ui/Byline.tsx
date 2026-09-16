import Icon from "@/components/ui/Icon";

export default function Byline({ name }: { name: string }) {
  const isTeam = name.trim().toLowerCase() === "team bulletin";

  return (
    <div className="flex items-center gap-2 text-xl font-bold">
      {isTeam ? (
        // Both themes' artwork is in the markup and the `dark` class on <html>
        // picks one, the same way everything else on the site switches.
        <>
          <img
            alt=""
            className="size-7 shrink-0 object-contain dark:hidden"
            height={850}
            width={850}
            src="/bulletin.png"
          />
          <img
            alt=""
            aria-hidden="true"
            className="hidden size-7 shrink-0 object-contain dark:block"
            height={850}
            width={850}
            src="/bulletin-dark.png"
          />
        </>
      ) : (
        <Icon name="person-circle" />
      )}
      <span>{name}</span>
    </div>
  );
}
