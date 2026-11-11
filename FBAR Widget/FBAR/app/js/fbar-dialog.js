/*
 * In-page message box (no window.alert / confirm). One dialog at a time; every method returns a Promise.
 *
 *   FbarDialog.alert({ title, message, details, tone })            -> resolves when closed
 *   FbarDialog.confirm({ title, message, details, confirmText, tone }) -> true / false
 *   FbarDialog.choose({ title, message, options: [{ value, label, detail }] }) -> value or null
 *
 * tone: "info" | "success" | "warning" | "error"
 */
(function (global) {
  "use strict";

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICONS = {
    info: '<path fill="currentColor" d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>',
    success: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/>',
    warning: '<path fill="currentColor" d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>',
    error: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
  };

  let host = null;
  let previousFocus = null;

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.className = "dlg-backdrop";
    host.hidden = true;
    document.body.appendChild(host);
    return host;
  }

  /*
   * Put the dialog beside the control that opened it (Save, a delete button, a dropdown) and scroll it into
   * view. Inside Creator the widget's iframe may be taller than the screen, so a fixed top position could
   * be off-screen.
   */
  function place(el) {
    const doc = document.documentElement;
    el.style.height = Math.max(doc.scrollHeight, document.body.scrollHeight) + "px";
    const box = el.querySelector(".dlg");
    const anchor = previousFocus && previousFocus !== document.body && previousFocus.getBoundingClientRect
      ? previousFocus.getBoundingClientRect() : null;
    const anchorTop = anchor && anchor.height ? anchor.top + window.scrollY : window.scrollY + 60;
    const maxTop = Math.max(0, el.offsetHeight - box.offsetHeight - 32);
    box.style.marginTop = Math.min(maxTop, Math.max(0, anchorTop - box.offsetHeight / 2)) + "px";
    try { box.scrollIntoView({ block: "nearest" }); } catch (e) { /* older browsers: the position above is enough */ }
  }

  function open({ title, message, details, tone = "info", buttons, options }) {
    const el = ensureHost();
    previousFocus = document.activeElement;
    const detailHTML = details && details.length
      ? `<ul class="dlg-details">${details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
    const optionHTML = options && options.length
      ? `<div class="dlg-options">${options.map((o, i) => `<button type="button" class="dlg-option" data-option="${i}">
          <span class="dlg-option-label">${esc(o.label)}</span>${o.detail ? `<span class="dlg-option-detail">${esc(o.detail)}</span>` : ""}</button>`).join("")}</div>` : "";
    el.innerHTML = `
      <div class="dlg dlg-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgMsg">
        <div class="dlg-head"><span class="dlg-icon"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[tone] || ICONS.info}</svg></span>
          <h2 id="dlgTitle">${esc(title)}</h2></div>
        <div class="dlg-body"><p id="dlgMsg">${esc(message)}</p>${detailHTML}${optionHTML}</div>
        <div class="dlg-foot">${buttons.map((b, i) => `<button type="button" class="btn ${b.primary ? "btn-primary" : ""} ${b.danger ? "btn-danger" : ""}" data-btn="${i}">${esc(b.text)}</button>`).join("")}</div>
      </div>`;
    el.hidden = false;
    place(el);

    return new Promise((resolve) => {
      const close = (value) => {
        el.hidden = true; el.innerHTML = "";
        document.removeEventListener("keydown", onKey, true);
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(value);
      };
      const cancelValue = buttons.find((b) => b.cancel);
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(cancelValue ? cancelValue.value : buttons[0].value); }
        if (e.key === "Tab") {                                  // keep focus inside the dialog
          const items = [...el.querySelectorAll("button")];
          const i = items.indexOf(document.activeElement);
          const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
          e.preventDefault(); items[next].focus();
        }
      };
      document.addEventListener("keydown", onKey, true);
      el.querySelectorAll("[data-btn]").forEach((b) => b.addEventListener("click", () => close(buttons[+b.dataset.btn].value)));
      el.querySelectorAll("[data-option]").forEach((b) => b.addEventListener("click", () => close(options[+b.dataset.option].value)));
      const primary = el.querySelector(".dlg-option") || el.querySelector(".btn-primary") || el.querySelector("[data-btn]");
      if (primary) primary.focus();
    });
  }

  global.FbarDialog = {
    alert({ title, message, details, tone = "info", okText = "OK" }) {
      return open({ title, message, details, tone, buttons: [{ text: okText, value: true, primary: true, cancel: true }] });
    },
    confirm({ title, message, details, tone = "warning", confirmText = "Continue", cancelText = "Cancel", danger = false }) {
      return open({ title, message, details, tone, buttons: [
        { text: cancelText, value: false, cancel: true },
        { text: confirmText, value: true, primary: !danger, danger },
      ] });
    },
    choose({ title, message, details, options, tone = "warning", cancelText = "Cancel" }) {
      return open({ title, message, details, tone, options, buttons: [{ text: cancelText, value: null, cancel: true }] });
    },
  };
})(window);
