/** Open a self-printing sign document (checkin-sign / parking-sign HTML) in
 *  its own window. The documents print themselves after fonts + logo load
 *  and close on afterprint. */
export function openSignWindow(html: string) {
  const w = window.open("", "_blank", "width=1140,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
