/** Small pure rules of the Git repository actions (clone, pull): what is taken for the address of a repository, what the clone's folder is called, what git said about a pull. No DOM. */

/** An address git can clone from the web or over ssh (the same rule the host applies: never a local path, `file:` or a transport that runs a command). */
export function isCloneUrl(text: string): boolean {
  const url = text.trim();
  if (!url || url.startsWith("-") || /\s/.test(url) || url.includes("::")) return false;
  return /^(?:https?|ssh|git):\/\//i.test(url) || (/^[^\s/@:]+@[^\s/:]+:\S+$/.test(url) && !url.includes("://"));
}

/** The folder a clone goes into when the person does not name one: the last part of the address without `.git`; null when there is nothing usable. */
export function cloneFolderName(addressOrName: string): string | null {
  const text = addressOrName.trim().replace(/[/\\]+$/, "").replace(/\.git$/i, "");
  const last = text.split(/[/\\:]/).pop() ?? "";
  const name = last.replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/^[-.]+/, "");
  return name && name !== "." && name !== ".." ? name.slice(0, 100) : null;
}

/** What a pull did, from what git printed: nothing new, or something. */
export function pullSummary(said: string): "current" | "updated" {
  return /already up[ -]to[ -]date/i.test(said) ? "current" : "updated";
}
