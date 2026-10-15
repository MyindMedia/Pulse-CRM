/* Shown inside the module bay while a page's code loads on navigation. The
   shell (rail, top bar) stays where it is, so this is just the bay's shape:
   a full-screen logo here used to blank the whole page between routes. */
export default function Loading() {
  return (
    <div aria-busy className="space-y-6">
      <span role="status" className="sr-only">
        Loading
      </span>
      <div aria-hidden className="grid grid-cols-1 gap-6 md:grid-cols-40">
        <div className="pl-card col-span-full min-h-[260px] opacity-60 xl:col-span-24" />
        <div className="pl-card col-span-full min-h-[260px] opacity-60 xl:col-span-16" />
        <div className="pl-card col-span-full min-h-[200px] opacity-60" />
      </div>
    </div>
  );
}
