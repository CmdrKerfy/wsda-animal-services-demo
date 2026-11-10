/* "Copy" beside each line to paste: copies the line exactly (straight quotes), so nothing is typed by hand. */
(function () {
  'use strict';
  function copied(button) {
    const was = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = was; }, 1500);
  }
  // The browser's clipboard where it is offered; else a hidden text box and the older copy command (a file opened
  // from a folder).
  function copy(text, button) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => copied(button), () => fallback(text, button));
    } else fallback(text, button);
  }
  function fallback(text, button) {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    try { document.execCommand('copy'); copied(button); } catch (e) { button.textContent = 'Select and copy'; }
    box.remove();
  }
  document.querySelectorAll('.paste').forEach(block => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copy';
    button.addEventListener('click', () => copy(block.querySelector('code').textContent, button));
    block.append(button);
  });
})();
