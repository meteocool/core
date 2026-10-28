/**
 * A row that scrolls sideways when it holds more than it has room for, and
 * says so by fading out the edge with more beyond it: no bar is drawn, and
 * a pill cut square reads as the end of the row.
 *
 * A Svelte action: it toggles `fade-start` and `fade-end` on the node as it
 * scrolls and as it or what it holds changes size. The fade itself is
 * `.mc-fade-x` in src/glass.css.
 */
export function fadeEdges(node: HTMLElement): { destroy(): void } {
  const update = () => {
    const { scrollLeft, scrollWidth, clientWidth } = node;
    node.classList.toggle("fade-start", scrollLeft > 1);
    node.classList.toggle("fade-end", scrollLeft + clientWidth < scrollWidth - 1);
  };
  const observer = new ResizeObserver(update);
  observer.observe(node);
  for (const child of Array.from(node.children)) observer.observe(child);
  node.addEventListener("scroll", update, { passive: true });
  update();
  return {
    destroy() {
      observer.disconnect();
      node.removeEventListener("scroll", update);
    },
  };
}
