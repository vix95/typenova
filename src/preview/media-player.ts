/** A small dialog that plays an audio or video file from disk, with TypeNova's own controls instead of the browser's. */
import { basename } from "../filesystem/path-utils";
import { fileKind } from "../filesystem/file-types.js";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";
import { localImageUrl } from "./code-blocks";
import { formatClock, nextSpeed, playerKeyAction, SKIP_SECONDS, skipTo } from "./media-format";

let dialog: HTMLDialogElement | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
function iconButton(className: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", className); button.type = "button"; button.innerHTML = icon; button.title = label; button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick); return button;
}
const range = (className: string, label: string, max: number, step: string): HTMLInputElement => {
  const input = el("input", className); input.type = "range"; input.min = "0"; input.max = String(max); input.step = step; input.value = "0"; input.setAttribute("aria-label", label); return input;
};
/** The control bar: play or pause, position, length, and volume. */
function buildControls(media: HTMLMediaElement, onFullscreen: (() => void) | null): HTMLElement {
  const bar = el("div", "media-controls");
  const toggle = iconButton("media-control", ICONS.play, "", () => { if (media.paused) void media.play().catch(() => { /* refused: the button stays */ }); else media.pause(); });
  const current = el("span", "media-time", "0:00"), length = el("span", "media-time", "0:00");
  const seek = range("media-seek", langText("Pozycja", "Position"), 1000, "1");
  const mute = iconButton("media-control", ICONS.volume, "", () => { media.muted = !media.muted; });
  const volume = range("media-volume", langText("Głośność", "Volume"), 100, "1"); volume.value = "100";
  let seeking = false;
  const sync = () => {
    const playLabel = media.paused ? langText("Odtwórz", "Play") : langText("Pauza", "Pause");
    toggle.innerHTML = media.paused ? ICONS.play : ICONS.pause; toggle.title = playLabel; toggle.setAttribute("aria-label", playLabel);
    const muted = media.muted || media.volume === 0, muteLabel = muted ? langText("Włącz dźwięk", "Unmute") : langText("Wycisz", "Mute");
    mute.innerHTML = muted ? ICONS.volumeOff : ICONS.volume; mute.title = muteLabel; mute.setAttribute("aria-label", muteLabel);
    volume.value = String(media.muted ? 0 : Math.round(media.volume * 100));
  };
  const progress = () => {
    const total = Number.isFinite(media.duration) ? media.duration : 0;
    current.textContent = formatClock(media.currentTime); length.textContent = formatClock(total);
    if (!seeking) seek.value = total ? String(Math.round((media.currentTime / total) * 1000)) : "0";
    seek.style.setProperty("--fill", `${Number(seek.value) / 10}%`);
  };
  seek.addEventListener("input", () => { seeking = true; if (Number.isFinite(media.duration)) media.currentTime = (Number(seek.value) / 1000) * media.duration; progress(); seeking = false; });
  volume.addEventListener("input", () => { media.muted = false; media.volume = Number(volume.value) / 100; });
  for (const name of ["play", "pause", "volumechange", "loadedmetadata"]) media.addEventListener(name, sync);
  for (const name of ["timeupdate", "loadedmetadata", "durationchange", "seeked"]) media.addEventListener(name, progress);
  media.addEventListener("ended", () => { media.currentTime = 0; sync(); progress(); });
  sync(); progress();
  bar.append(toggle, current, seek, length, mute, volume);
  const speedLabel = el("span", "media-time media-speed-label", "1x");
  const speed = iconButton("media-control", ICONS.speed, langText("Prędkość odtwarzania", "Playback speed"), () => {
    media.playbackRate = nextSpeed(media.playbackRate);
  });
  media.addEventListener("ratechange", () => { speedLabel.textContent = `${media.playbackRate}x`; });
  bar.append(speed, speedLabel);
  if (onFullscreen) bar.append(iconButton("media-control", ICONS.fullscreen, langText("Pełny ekran (F)", "Full screen (F)"), onFullscreen));
  return bar;
}

export async function openMediaPlayer(path: string): Promise<void> {
  const kind = fileKind(path), name = basename(path);
  try {
    const media = el(kind === "video" ? "video" : "audio", "media-player-element");
    media.controls = false; media.preload = "metadata"; media.setAttribute("aria-label", name);
    media.src = await localImageUrl(path);
    media.addEventListener("error", () => showToast(`${langText("Nie udało się odtworzyć pliku (format lub kodek nieobsługiwany)", "Could not play the file (format or codec not supported)")}: ${name}`));
    dialog?.remove();
    dialog = el("dialog", "media-player-dialog"); dialog.setAttribute("aria-label", name);
    const header = el("div", "media-player-header");
    const title = el("span", "", name); title.title = path;
    header.append(title, iconButton("media-control", ICONS.close, langText("Zamknij", "Close"), () => dialog?.close()));
    dialog.append(header);
    const shell = dialog;
    const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void shell.requestFullscreen().catch(() => { /* not available */ }); };
    const toggle = () => { if (media.paused) void media.play().catch(() => { }); else media.pause(); };
    if (kind === "video") { media.addEventListener("click", toggle); media.addEventListener("dblclick", fullscreen); dialog.append(media); }
    dialog.append(buildControls(media, kind === "video" ? fullscreen : null));
    if (kind !== "video") dialog.append(media);
    document.body.append(dialog);
    dialog.addEventListener("close", () => { media.pause(); media.removeAttribute("src"); media.load(); dialog?.remove(); dialog = null; });
    dialog.addEventListener("keydown", event => {
      const target = event.target as HTMLElement;
      const action = playerKeyAction(event.key, target.tagName, kind === "video");
      if (!action) return;
      event.preventDefault();
      if (action === "toggle") toggle();
      else if (action === "forward") media.currentTime = skipTo(media.currentTime, SKIP_SECONDS, media.duration);
      else if (action === "back") media.currentTime = skipTo(media.currentTime, -SKIP_SECONDS, media.duration);
      else if (action === "mute") media.muted = !media.muted;
      else fullscreen();
    });
    dialog.showModal();
    void media.play().catch(() => { /* autoplay may be refused; the play button is there */ });
  } catch (error) {
    showToast(`${langText("Nie udało się otworzyć pliku", "Could not open the file")}: ${name} (${String(error)})`);
  }
}
