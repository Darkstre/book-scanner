# Book Scanner

A capture form for **Book Collection**, usable from any phone, including iPhone: scan the barcode (or type the ISBN),
tap the format, grade, jacket and printing, and the book goes to the queue in **your own** GitHub account. The Book
Collection program on your PC does all the processing (lookups, your other copies, values, research) and saves it to
your collection.

**Open it:** https://darkstre.github.io/book-scanner/ — then Share → *Add to Home Screen* to use it like an app.

## Privacy
- The page contains no keys. Your GitHub username and token are typed into the page and kept **only in your
  phone's browser** (local storage); they are sent only to GitHub.
- Use a fine-grained token limited to your queue repository (Contents: read and write). The page can't see your
  book list at all.
- A quick Open Library lookup confirms the book before it's queued.

## Notes
- Barcode reading uses the browser's built-in detector where there is one, otherwise
  [html5-qrcode](https://github.com/mebjas/html5-qrcode) 2.3.8.
- Same capture rules as the desktop and Android apps (condition standard, printing, ISBN checks).
