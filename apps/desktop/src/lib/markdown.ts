import { marked } from "marked";

/**
 * Render note content to HTML for the read view. We keep GitHub-style task list
 * items (`- [ ]` / `- [x]`) as real checkboxes carrying a `data-line` attribute
 * so the editor can toggle the underlying source line when one is clicked.
 */
marked.use({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  // Tag each task-list line with its line index before handing to marked, then
  // rewrite the produced checkbox <li> to be interactive.
  const lines = source.split("\n");
  let html = marked.parse(source, { async: false }) as string;

  // marked emits: <li><input ... type="checkbox" [checked] disabled> text</li>
  // Make them enabled and attach the matching source line index.
  let taskIndex = -1;
  const taskLineNumbers = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /^\s*[-*]\s+\[[ xX]\]/.test(l))
    .map(({ i }) => i);

  html = html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (_m, a, b) => {
    taskIndex += 1;
    const line = taskLineNumbers[taskIndex];
    const attrs = `${a}${b}`.replace(/\sdisabled/g, "");
    return `<input${attrs}type="checkbox" data-line="${line}">`;
  });

  return html;
}

/** Toggle the `[ ]`/`[x]` state of a single source line. */
export function toggleTaskLine(source: string, lineIndex: number): string {
  const lines = source.split("\n");
  const line = lines[lineIndex];
  if (line == null) return source;
  if (/\[\s\]/.test(line)) {
    lines[lineIndex] = line.replace(/\[\s\]/, "[x]");
  } else if (/\[[xX]\]/.test(line)) {
    lines[lineIndex] = line.replace(/\[[xX]\]/, "[ ]");
  }
  return lines.join("\n");
}

/** First non-empty line, stripped of markdown, for board/list previews. */
export function noteTitle(source: string): string {
  const first = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return "Untitled note";
  return first
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s+\[[ xX]\]\s*/, "")
    .replace(/[*_`>#]/g, "")
    .slice(0, 80);
}
