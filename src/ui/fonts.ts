import { IBM_Plex_Mono, Inter, Special_Elite } from 'next/font/google';
import type { Fonts } from '@/engine/textures/prints';

/** Typewriter face for everything written by hand on a tape (and the interface's headings). */
export const serif = Special_Elite({ subsets: ['latin'], weight: '400', variable: '--font-serif' });
export const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });
export const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const FONT_VARS = `${serif.variable} ${mono.variable} ${sans.variable}`;

export const FONTS: Fonts = {
  serif: serif.style.fontFamily,
  mono: mono.style.fontFamily,
  sans: sans.style.fontFamily,
};

/** Resolves once the faces used by textures are ready to draw into canvases. */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const want = [`400 20px ${FONTS.serif}`, `500 20px ${FONTS.mono}`, `600 20px ${FONTS.sans}`, `700 20px ${FONTS.sans}`];
  await Promise.race([Promise.all(want.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
}
