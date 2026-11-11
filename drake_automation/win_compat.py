"""
Windows compatibility fixes, applied once at start-up (import this module before any Drake automation runs).

win32gui.EnumWindows / EnumChildWindows (pywin32) raise
    pywintypes.error: (2, 'EnumWindows', 'The system cannot find the file specified.')
on some PCs / pywin32 builds even though the window walk worked: Windows returns FALSE with a stale
"last error" code (or a callback returned False to stop early), and pywin32 turns that into an exception.
That aborted the whole Drake transfer at "[DRAKE] Connecting to Drake Tax…".

The wrapper below
  * makes a callback that returns None mean "keep going" (as intended),
  * keeps scanning when one window raises inside a callback (a window can close mid-scan),
  * swallows the spurious pywintypes.error — everything the callback collected is kept.
Every existing `win32gui.EnumWindows(cb, extra)` call in the project benefits without other changes.
"""

_PATCHED = False


def apply():
    global _PATCHED
    if _PATCHED:
        return
    try:
        import win32gui
        import pywintypes
    except Exception:          # not Windows / pywin32 not installed — nothing to patch
        return

    def _tolerant(orig, name):
        def enum(*args):
            args = list(args)
            # signature: EnumWindows(cb, extra)  /  EnumChildWindows(hwnd, cb, extra)
            i = 0 if name == "EnumWindows" else 1
            cb = args[i] if len(args) > i else None
            if callable(cb):
                def safe_cb(hwnd, extra, _cb=cb):
                    try:
                        r = _cb(hwnd, extra)
                    except Exception:
                        return True            # skip this window, keep scanning
                    return True if r is None else r
                args[i] = safe_cb
            try:
                return orig(*args)
            except pywintypes.error:
                return None                    # spurious failure — results already collected
        enum.__wrapped__ = orig
        return enum

    for name in ("EnumWindows", "EnumChildWindows"):
        orig = getattr(win32gui, name, None)
        if orig is not None and not hasattr(orig, "__wrapped__"):
            setattr(win32gui, name, _tolerant(orig, name))
    _PATCHED = True


apply()
