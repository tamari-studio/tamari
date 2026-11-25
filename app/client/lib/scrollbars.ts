// Overlay-style scrollbars app-wide. base.css keeps every thumb transparent and
// draws it only on elements marked data-scrolling, which this sets while an
// element scrolls and clears shortly after it stops.
type Root = EventTarget & Pick<Document, 'documentElement'>

export function installScrollbars(root: Root = document, hideAfterMs = 1000): void {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  root.addEventListener(
    'scroll',
    event => {
      // Element scrolls don't bubble, so listen in the capture phase; page scrolls target the document.
      const el = event.target === root ? root.documentElement : (event.target as Element)
      clearTimeout(timers.get(el))
      if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '')
      timers.set(
        el,
        setTimeout(() => el.removeAttribute('data-scrolling'), hideAfterMs)
      )
    },
    { capture: true, passive: true }
  )
}
