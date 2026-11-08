/** PDF viewer dialog: pages are drawn on canvases (pdf.js) as they scroll into view, with zoom, fit to width and a page counter. */
import { ICONS } from "../ui/icons";
import { readFile } from "@tauri-apps/plugin-fs";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

type PdfModule = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

let pdfModule: Promise<PdfModule> | null = null;
function loadPdfJs(): Promise<PdfModule> {
  if (!pdfModule) {
    pdfModule = Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfModule;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const button = (label: string, icon: string, onClick: () => void) => { const node = el("button", "pdf-tool"); node.innerHTML = icon; node.type = "button"; node.title = label; node.setAttribute("aria-label", label); node.addEventListener("click", onClick); return node; };

export async function openPdfFile(path: string): Promise<void> {
  const name = basename(path);
  let pdf: PdfDocument | null = null;
  try {
    const [pdfjs, bytes] = await Promise.all([loadPdfJs(), readFile(path)]);
    pdf = await pdfjs.getDocument({ data: bytes }).promise;
  } catch (error) {
    showToast(`${langText("Nie udało się otworzyć PDF", "Could not open the PDF")}: ${name} (${String((error as Error)?.message ?? error)})`);
    return;
  }
  const document_ = pdf;
  const dialog = el("dialog", "pdf-dialog"); dialog.setAttribute("aria-label", name);
  const title = el("span", "pdf-title", name); title.title = path;
  const counter = el("span", "pdf-counter"); counter.setAttribute("aria-live", "polite");
  const level = el("span", "pdf-level");
  const pages = el("div", "pdf-pages"); pages.tabIndex = 0;
  let zoom = 1, fitWidth = true;
  const tools = el("div", "pdf-tools");
  const redraw = () => { level.textContent = `${Math.round(zoom * 100)}%`; build(); };
  tools.append(
    button(langText("Pomniejsz", "Zoom out"), ICONS.minus, () => { fitWidth = false; zoom = Math.max(0.25, zoom / 1.2); redraw(); }),
    level,
    button(langText("Powiększ", "Zoom in"), ICONS.plus, () => { fitWidth = false; zoom = Math.min(4, zoom * 1.2); redraw(); }),
    button(langText("Dopasuj do szerokości", "Fit to width"), ICONS.fitWidth, () => { fitWidth = true; build(); }),
  );
  const close = el("button", "", langText("Zamknij", "Close")); close.type = "button";
  const header = el("div", "pdf-header"); header.append(title, counter, tools, close);
  dialog.append(header, pages); document.body.append(dialog);

  let observer: IntersectionObserver | null = null;
  const pageHolders: HTMLElement[] = [];

  /** Creates an empty box per page (so scrolling and the counter work at once) and draws a page when it comes near the view. */
  function build(): void {
    observer?.disconnect(); pages.replaceChildren(); pageHolders.length = 0;
    void (async () => {
      const first = await document_.getPage(1);
      const natural = first.getViewport({ scale: 1 });
      if (fitWidth) zoom = Math.min(3, Math.max(0.3, (pages.clientWidth - 32) / natural.width)); level.textContent = `${Math.round(zoom * 100)}%`;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const holder = entry.target as HTMLElement;
          if (entry.isIntersecting && !holder.dataset.drawn) { holder.dataset.drawn = "1"; void draw(holder); }
        }
      }, { root: pages, rootMargin: "600px 0px" });
      for (let number = 1; number <= document_.numPages; number++) {
        const holder = el("div", "pdf-page"); holder.dataset.page = String(number);
        holder.style.width = `${Math.round(natural.width * zoom)}px`; holder.style.height = `${Math.round(natural.height * zoom)}px`;
        pageHolders.push(holder); pages.append(holder); observer.observe(holder);
      }
      counter.textContent = `${langText("Strona", "Page")} 1 ${langText("z", "of")} ${document_.numPages}`;
    })();
  }

  async function draw(holder: HTMLElement): Promise<void> {
    const page = await document_.getPage(Number(holder.dataset.page));
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: zoom * ratio });
    const canvas = el("canvas"); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`; canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    holder.style.width = canvas.style.width; holder.style.height = canvas.style.height;
    holder.replaceChildren(canvas);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise.catch(() => { /* a redraw replaced it */ });
  }

  pages.addEventListener("scroll", () => {
    const top = pages.getBoundingClientRect().top + pages.clientHeight / 3;
    const current = pageHolders.find(holder => holder.getBoundingClientRect().bottom > top);
    if (current) counter.textContent = `${langText("Strona", "Page")} ${current.dataset.page} ${langText("z", "of")} ${document_.numPages}`;
  }, { passive: true });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { observer?.disconnect(); void document_.destroy(); dialog.remove(); });
  dialog.showModal();
  requestAnimationFrame(build);
}
