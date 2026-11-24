/**
 * A mouse pointer drawn into demo recordings, since a canvas capture never includes the real one.
 * Coordinates are in the recorded canvas's pixels; `scale` is its device-pixel ratio.
 */
export type PointerState = { x: number; y: number; inside: boolean; down: boolean; grabbing: boolean };

const POINTER_SIZE = 1.4;

/** Standard arrow pointer, tip at (0, 0), in CSS pixels. */
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 17], [4.2, 13], [7, 19.4], [9.8, 18.2], [7.1, 12], [12.6, 12],
];

function arrow(g: CanvasRenderingContext2D): void {
  g.beginPath();
  ARROW.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 1.6;
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#111111';
  g.stroke();
  g.fill();
}

/** Closed hand, drawn while dragging the player or a tape. */
function hand(g: CanvasRenderingContext2D): void {
  g.translate(-8, -8);
  g.lineWidth = 1.5;
  g.strokeStyle = '#111111';
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(1.5, 4.5, 14, 11, 4.5);
  g.fill();
  g.stroke();
  g.beginPath();
  for (const x of [5, 8.5, 12]) {
    g.moveTo(x, 4.8);
    g.lineTo(x, 8.4);
  }
  g.stroke();
}

/** Draws the pointer, with a soft ring while the button is held so clicks read on video. */
export function drawPointer(g: CanvasRenderingContext2D, p: PointerState, scale: number): void {
  if (!p.inside) return;
  g.save();
  g.translate(p.x, p.y);
  // A touch larger than life so it reads on a phone screen too.
  g.scale(scale * POINTER_SIZE, scale * POINTER_SIZE);
  if (p.down) {
    g.beginPath();
    g.arc(0, 0, 15, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20, 20, 20, 0.12)';
    g.strokeStyle = 'rgba(20, 20, 20, 0.35)';
    g.lineWidth = 1.2;
    g.fill();
    g.stroke();
  }
  g.shadowColor = 'rgba(0, 0, 0, 0.3)';
  g.shadowBlur = 3;
  g.shadowOffsetY = 1;
  if (p.grabbing) hand(g);
  else arrow(g);
  g.restore();
}
