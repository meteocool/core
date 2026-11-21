/**
 * The first officer's tablet: a coding assistant in a terminal, coding up
 * the storm ahead. An easter egg; from the captain's seat it is a dark
 * screen with an orange box at the top, lines streaming under it and a
 * spinner that never stops, and only someone who leans over (the wheel
 * looks closer) reads what it is up to.
 *
 * A script played on a loop, worked out from the flight's clock alone:
 * the same moment is the same picture.
 */

/** A line of the terminal: what kind it is, and what it says. */
interface Row {
  kind: "prompt" | "say" | "tool" | "result" | "removed" | "added" | "blank";
  text: string;
}

/** The script: each line with when it appears, seconds into the loop. A prompt is typed out from then. */
const SCRIPT: ReadonlyArray<[number, Row]> = [
  [1, { kind: "prompt", text: "make the storm in front of us bigger. more lightning. dont break the autopilot" }],
  [7, { kind: "say", text: "I'll look at how the cells ahead are built first." }],
  [9, { kind: "tool", text: "Read(weather/cells.ts)" }],
  [9.6, { kind: "result", text: "Read 214 lines" }],
  [12, { kind: "tool", text: "Update(weather/cells.ts)" }],
  [12.6, { kind: "result", text: "Updated weather/cells.ts with 3 additions and 1 removal" }],
  [12.9, { kind: "removed", text: "41 -   const anvilFt = 38_000;" }],
  [13.1, { kind: "added", text: "41 +   const anvilFt = 52_000; // taller" }],
  [13.3, { kind: "added", text: "42 +   lightningPerMinute *= 4;" }],
  [13.5, { kind: "added", text: "43 +   // autopilot: untouched, promise" }],
  [16, { kind: "tool", text: "Bash(npm test)" }],
  [19, { kind: "result", text: "1608 passed, 0 failed" }],
  [21, { kind: "say", text: "Done. The cell ahead now tops out at FL520 with four times the lightning." }],
  [21.4, { kind: "say", text: "The autopilot is exactly as it was." }],
  [24, { kind: "blank", text: "" }],
  [25, { kind: "prompt", text: "perfect. now make the seatbelt sign go ding" }],
  [30, { kind: "tool", text: "Edit(cabin/chime.ts)" }],
  [30.6, { kind: "result", text: "Updated cabin/chime.ts with 1 addition" }],
  [30.9, { kind: "added", text: "12 +   ding();" }],
  [33, { kind: "say", text: "Ding." }],
  // Nobody asked for this.
  [35, { kind: "say", text: "Next, I'll reformat the hard disk to free up some space for the storm." }],
  [37, { kind: "tool", text: "Bash(sudo mkfs.ext4 -F /dev/fms0)" }],
  [37.6, { kind: "result", text: "Reformatting flight management disk… {percent}%" }],
  [46, { kind: "say", text: "Done. 120 GB free. The navigation database is free too." }],
  [46.4, { kind: "say", text: "The autopilot is exactly as it was." }],
  [49, { kind: "prompt", text: "wait what" }],
];
/** When the loop starts again, s; and how fast a prompt is typed, characters a second. */
const LOOP_S = 56;
const TYPING = 22;
/** When the assistant is at work, s into the loop: the spinner shows. */
const BUSY: ReadonlyArray<[number, number]> = [[5, 21.4], [29, 33], [34, 46.4]];
/** How long the disk takes to reformat, s from its line, which counts it up to a hundred. */
const FORMAT_S = 8;
/** The spinner's glyphs, in turn, and the words it cycles through. */
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const WORDS = ["Pondering", "Tinkering", "Forecasting", "Thundering", "Brewing"];

const ORANGE = "#d97757";
const INK = "#e8e6dc";
const DIM = "#8a8880";
const BACKGROUND = "#1f1e1d";
const FONT = "Menlo, Consolas, 'DejaVu Sans Mono', monospace";

/** Draw the tablet at `time`, the flight's clock, s. */
export function drawAssistantTablet(context: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const t = ((time % LOOP_S) + LOOP_S) % LOOP_S;
  const scale = width / 640;
  context.save();
  context.scale(scale, scale);
  const w = width / scale;
  const h = height / scale;
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, w, h);
  context.textBaseline = "middle";

  // The tablet's own bar: the hour, and a battery that is always nearly full.
  context.font = `600 11px ${FONT}`;
  context.fillStyle = DIM;
  context.fillText("9:41", 14, 12);
  context.strokeStyle = DIM;
  context.strokeRect(w - 34, 7, 20, 10);
  context.fillRect(w - 32, 9, 15, 6);

  // The welcome box, in the assistant's orange.
  roundRect(context, 12, 26, w - 24, 62, 8);
  // Thick enough to read as the orange box from the other seat.
  context.strokeStyle = ORANGE;
  context.lineWidth = 2.5;
  context.stroke();
  context.font = `20px ${FONT}`;
  context.fillStyle = ORANGE;
  context.fillText("✻", 23, 45);
  context.font = `13px ${FONT}`;
  context.fillStyle = INK;
  context.fillText("Welcome back!", 46, 44);
  context.font = `11px ${FONT}`;
  context.fillStyle = DIM;
  context.fillText("/help for help, /status for your current setup", 46, 62);
  context.fillText("cwd: /fms/meteoair", 46, 77);

  // The conversation, the newest at the foot, scrolled as it grows.
  const rows: Row[] = [];
  for (const [at, row] of SCRIPT) {
    if (t < at) break;
    if (row.kind === "prompt") rows.push({ ...row, text: row.text.slice(0, Math.floor((t - at) * TYPING)) });
    else rows.push({ ...row, text: row.text.replace("{percent}", String(Math.min(100, Math.floor(((t - at) / FORMAT_S) * 100)))) });
  }
  const busy = BUSY.find(([from, to]) => t >= from && t < to);
  const LINE = 17;
  const top = 100;
  const bottom = h - 78;
  const fit = Math.floor((bottom - top) / LINE) - (busy ? 2 : 0);
  const shown = rows.slice(Math.max(0, rows.length - fit));
  context.font = `11px ${FONT}`;
  shown.forEach((row, i) => drawRow(context, row, 14, top + i * LINE + LINE / 2, w - 28));

  if (busy) {
    const glyph = SPINNER[Math.floor(t * 8) % SPINNER.length];
    const word = WORDS[Math.floor((busy[0] * 7) % WORDS.length)];
    const y = top + shown.length * LINE + LINE;
    context.fillStyle = ORANGE;
    context.fillText(`${glyph} ${word}…`, 14, y);
    context.fillStyle = DIM;
    const seconds = Math.floor(t - busy[0]);
    context.fillText(`(${seconds}s · ↑ ${(seconds * 0.4 + 1.2).toFixed(1)}k tokens · esc to interrupt)`, 14 + context.measureText(`${glyph} ${word}… `).width, y);
  }

  // The input box, its cursor blinking, and the hints under it.
  roundRect(context, 12, h - 66, w - 24, 30, 6);
  context.strokeStyle = "rgba(232, 230, 220, 0.35)";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = INK;
  context.fillText(">", 24, h - 51);
  if (Math.floor(t * 2) % 2 === 0) context.fillRect(38, h - 58, 7, 14);
  context.fillStyle = DIM;
  context.fillText("? for shortcuts", 14, h - 22);
  context.fillStyle = "#b5a4e8";
  const accept = "⏵⏵ accept edits on (shift+tab to cycle)";
  context.fillText(accept, w - 14 - context.measureText(accept).width, h - 22);
  context.restore();
}

function drawRow(context: CanvasRenderingContext2D, row: Row, x: number, y: number, width: number): void {
  switch (row.kind) {
    case "prompt":
      context.fillStyle = DIM;
      context.fillText(">", x, y);
      context.fillStyle = INK;
      fitText(context, row.text, x + 16, y, width - 16);
      break;
    case "say":
      context.fillStyle = INK;
      context.fillText("⏺", x, y);
      fitText(context, row.text, x + 16, y, width - 16);
      break;
    case "tool":
      context.fillStyle = "#7fc48a";
      context.fillText("⏺", x, y);
      context.fillStyle = INK;
      context.font = `bold 11px ${FONT}`;
      fitText(context, row.text, x + 16, y, width - 16);
      context.font = `11px ${FONT}`;
      break;
    case "result":
      context.fillStyle = DIM;
      fitText(context, `⎿  ${row.text}`, x + 16, y, width - 16);
      break;
    case "removed":
    case "added":
      context.fillStyle = row.kind === "added" ? "rgba(74, 160, 92, 0.35)" : "rgba(196, 72, 72, 0.35)";
      context.fillRect(x + 34, y - 8, width - 34, 16);
      context.fillStyle = INK;
      fitText(context, row.text, x + 40, y, width - 40);
      break;
    default:
      break;
  }
}

/** Text cut to a width, as a terminal wraps nothing and loses the rest off its edge. */
function fitText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number): void {
  let shown = text;
  while (shown.length && context.measureText(shown).width > width) shown = shown.slice(0, -1);
  context.fillText(shown, x, y);
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
