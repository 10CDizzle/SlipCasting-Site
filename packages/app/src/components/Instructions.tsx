/**
 * The Instructions tab.
 *
 * A Document in Onshape is a container of tabs of different kinds, not a single
 * file -- so the pour instructions live here as a tab in their own right. They are
 * as much a part of the design as the geometry, and they ship inside the ZIP too.
 */
import type { ReactNode } from 'react';
import { useStore } from '../state/store.ts';

export function Instructions() {
  const regen = useStore((s) => s.regen);
  const exportZip = useStore((s) => s.exportZip);
  const docName = useStore((s) => s.docName);

  if (!regen?.instructions) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-500">
        Generate a mold to see the instructions.
      </div>
    );
  }

  const download = async () => {
    const blob = await exportZip();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docName || 'slipcast'}-mold.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto bg-shell-900 px-6 py-6" data-testid="instructions">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => void download()}
          className="mb-5 rounded bg-pick px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          data-testid="download-zip-tab"
        >
          Download STLs + instructions
        </button>
        <article>{render(regen.instructions)}</article>
      </div>
    </div>
  );
}

/**
 * A deliberately small Markdown renderer. Pulling in a full parser to display a
 * document this app wrote itself, in a format it controls, would be a strange
 * trade for a static site that has to ship its whole geometry kernel as WASM.
 */
function render(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = md.split('\n');
  let table: string[] = [];
  let list: string[] = [];

  const flushTable = (key: number) => {
    if (table.length === 0) return;
    const rows = table
      .filter((r) => !/^\|[\s:|-]+\|$/.test(r))
      .map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));

    blocks.push(
      <table key={`t${key}`} className="my-3 w-full border-collapse text-xs">
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-shell-600">
              {cells.map((c, j) => (
                <td key={j} className="py-1.5 pr-4 align-top text-ink-300">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    );
    table = [];
  };

  const flushList = (key: number) => {
    if (list.length === 0) return;
    blocks.push(
      <ol
        key={`l${key}`}
        className="my-2 ml-4 list-decimal space-y-1.5 text-xs leading-relaxed text-ink-300"
      >
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ol>,
    );
    list = [];
  };

  lines.forEach((line, i) => {
    if (line.startsWith('|')) {
      flushList(i);
      table.push(line);
      return;
    }
    flushTable(i);

    const ordered = /^\d+\.\s+(.*)/.exec(line);
    if (ordered) {
      list.push(ordered[1]!);
      return;
    }
    flushList(i);

    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={i} className="mt-6 border-b border-shell-600 pb-1 text-base font-semibold text-ink-100">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={i} className="mb-2 text-xl font-semibold text-ink-100">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith('- ')) {
      blocks.push(
        <p key={i} className="ml-4 text-xs leading-relaxed text-ink-300">
          &bull; {inline(line.slice(2))}
        </p>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={i} className="my-2 text-xs leading-relaxed text-ink-300">
          {inline(line)}
        </p>,
      );
    }
  });

  flushTable(9990);
  flushList(9991);
  return blocks;
}

/** Bold only -- that is all the generated document uses. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink-100">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
