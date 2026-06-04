import { h } from './ui.js';

function cssSize(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' ? `${value}px` : String(value);
}

export function attachGoldScrollIndicator(scroller, options = {}) {
  if (!scroller || typeof scroller.addEventListener !== 'function') return () => {};
  const host = options.host || scroller.parentElement;
  if (!host) return () => {};

  const track = h('div', {
    class: `gold-scroll-track ${options.className || ''}`.trim(),
    'aria-hidden': 'true',
  }, [h('div', { class: 'gold-scroll-thumb' })]);
  track.style.setProperty('--gold-scroll-top', cssSize(options.top, '86px'));
  track.style.setProperty('--gold-scroll-bottom', cssSize(options.bottom, '14px'));
  host.appendChild(track);

  const thumb = track.firstElementChild;
  let raf = 0;
  let removed = false;

  function update() {
    raf = 0;
    if (removed || !thumb) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const canScroll = max > 8;
    track.classList.toggle('visible', canScroll);
    if (!canScroll) return;

    const trackHeight = track.clientHeight || 1;
    const thumbHeight = Math.max(44, Math.round((scroller.clientHeight / scroller.scrollHeight) * trackHeight));
    const travel = Math.max(0, trackHeight - thumbHeight);
    const y = Math.round((scroller.scrollTop / max) * travel);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }

  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(scroller, { childList: true, subtree: true });
  requestAnimationFrame(update);
  setTimeout(schedule, 120);

  return () => {
    removed = true;
    if (raf) cancelAnimationFrame(raf);
    scroller.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    observer.disconnect();
    track.remove();
  };
}
