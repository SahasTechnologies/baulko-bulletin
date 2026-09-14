// The server renders in UTC and readers are in Sydney, so a timestamp like
// 2024-03-21T20:37Z formats as two different days on each side. React then
// throws a hydration mismatch (#418) and re-renders the subtree. Pinning the
// timezone keeps both renders identical — and the date is a publication date,
// so it should read the same for everyone anyway.
const formatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Australia/Sydney",
});

export default function DateComponent({ dateString }: { dateString: string }) {
  return (
    <time dateTime={dateString}>
      {formatter.format(new Date(dateString))}
    </time>
  );
}
