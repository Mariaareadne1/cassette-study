/** Browser-only media helpers: probing audio, decoding artwork, saving files. */
import { LIMITS } from './schema';

const PROBE_TIMEOUT_MS = 15000;

/** Reads a file's duration by letting the browser decode its header. Rejects with a readable reason. */
export function probeDuration(file: Blob, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'metadata';
    const done = (fn: () => void): void => {
      window.clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = window.setTimeout(() => done(() => reject(new Error(`“${name}” took too long to open.`))), PROBE_TIMEOUT_MS);
    el.onloadedmetadata = () => {
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 0) done(() => reject(new Error(`“${name}” has no readable length.`)));
      else if (d > LIMITS.maxDuration) done(() => reject(new Error(`“${name}” is longer than 60 minutes — a side holds up to 60.`)));
      else done(() => resolve(d));
    };
    el.onerror = () => done(() => reject(new Error(`This browser can’t play “${name}”. Try MP3 or WAV.`)));
    el.src = url;
  });
}

export async function decodeArt(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('That image couldn’t be read.');
  }
}

/** Hands the user a file. Nothing is uploaded; the browser saves it locally. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'tape'
  );
}
