/**
 * Pull the words out of a PDF in the browser.
 *
 * Client-side on purpose, matching the inventory spreadsheet importer: the
 * uploaded file never reaches the server, only the text does. That keeps a
 * parser's attack surface off the backend and out of other tenants' way,
 * and it means a 30MB manual costs nothing to store.
 */
export async function pdfToText(file: File, maxChars = 24_000): Promise<string> {
  // Imported lazily so the PDF engine is not in the bundle of every page.
  const pdfjs = await import("pdfjs-dist");
  /*
   * Run the parse on this thread. pdf.js otherwise fetches its worker from a
   * CDN path that Next does not serve, which fails at runtime rather than at
   * build time. A spec sheet is a few pages, so the main thread is fine and
   * one fewer moving part is worth more than the parallelism.
   */
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  (pdfjs as unknown as { disableWorker?: boolean }).disableWorker = true;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer, useWorkerFetch: false, isEvalSupported: false })
    .promise;

  const parts: string[] = [];
  let total = 0;

  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    parts.push(text);
    total += text.length;
    // A manual's I/O table is near the front. Stop once we have enough
    // rather than shipping a novel to the model.
    if (total >= maxChars) break;
  }

  return parts.join("\n\n").slice(0, maxChars);
}

/** Read a plain text file. */
export async function plainToText(file: File, maxChars = 24_000): Promise<string> {
  return (await file.text()).slice(0, maxChars);
}
