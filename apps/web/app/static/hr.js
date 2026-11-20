/* Interacoes locais: selecao persistente, dialog acessivel e foco apos HTMX. */
(() => {
  let returnFocus = null;
  const close = () => {
    const host = document.getElementById('hr-dialog');
    if (host) host.replaceChildren();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-dialog]')) close();
  });
  document.addEventListener('hrCloseDialog', close);
  document.addEventListener('htmx:beforeRequest', event => {
    if (event.detail.target?.id === 'hr-dialog') returnFocus = document.activeElement;
  });
  document.addEventListener('htmx:afterSwap', event => {
    const selected = document.querySelector('#workspace-detail [data-selected]')?.dataset.selected;
    document.querySelectorAll('[data-ticket]').forEach(card => card.classList.toggle('is-selected', card.dataset.ticket === selected));
    if (event.detail.target.id === 'hr-dialog') document.querySelector('#hr-dialog [role="dialog"]')?.focus();
    if (event.detail.target.id === 'workspace-detail' && window.matchMedia('(max-width: 900px)').matches) event.detail.target.scrollIntoView({block: 'start'});
  });
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('#hr-dialog [role="dialog"]');
    if (!dialog) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const controls = dialog.querySelectorAll('button, a[href], textarea, input, select');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
})();
