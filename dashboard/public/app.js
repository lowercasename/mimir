// Sync the poll-countdown animation duration to the configured interval.
// Done via CSSOM (not inline style attributes) to stay within the CSP.
function armPollBars(root) {
  const els = (root instanceof Element ? root : document).querySelectorAll(
    ".poll-fill[data-poll-duration]",
  );
  els.forEach((el) => {
    el.style.animationDuration = el.dataset.pollDuration + "s";
  });
}
document.addEventListener("DOMContentLoaded", () => armPollBars(document));
document.addEventListener("htmx:afterSwap", (e) => armPollBars(e.target));

// Copy-to-clipboard for [data-copy] buttons (event delegation survives swaps).
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(() => {
    const prev = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => (btn.textContent = prev), 1200);
  });
});
