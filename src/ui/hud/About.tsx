import { SHORTCUTS } from './useShortcuts';

/** Credits, method and keyboard reference. */
export function About() {
  return (
    <div className="cs-about">
      <p className="cs-lede">
        A transparent late-1990s portable cassette player, built as an object you can actually use: open the door, load the tape,
        play it, wind it, turn it over — or record your own tape and keep it on the shelf.
      </p>
      <h3>Credits</h3>
      <p>
        The glass rendering — the studio cube map, ray-traced refraction rods, framebuffer sequence and four-point stars — is
        adapted from{' '}
        <a href="https://www.bubbbly.com/cd-case" target="_blank" rel="noopener noreferrer">
          Ann Nguyen’s CD case
        </a>{' '}
        (
        <a href="https://github.com/annnguyentt/vibe-coding/tree/main/cd-case" target="_blank" rel="noopener noreferrer">
          source
        </a>
        ), made with{' '}
        <a href="https://www.typingmind.com" target="_blank" rel="noopener noreferrer">
          TypingMind
        </a>
        . The cassette player, its mechanism, transport model, sound and library are new work for this study.
      </p>
      <p>
        Demo recordings “Glass Morning” and “Night Index” are synthesised from code in this repository. Mechanical sounds are
        synthesised live with Web Audio. No brand marks are used.
      </p>
      <h3>Your tapes stay here</h3>
      <p>Audio you add is stored only in this browser (IndexedDB). Nothing is uploaded.</p>
      <h3>Keyboard</h3>
      <dl className="cs-shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
