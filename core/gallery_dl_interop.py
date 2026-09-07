# SPDX-License-Identifier: MIT
"""Runtime interop with the external ``gallery-dl`` tool (Zerochan extractor).

``gallery-dl`` is GPL-2.0-only software by Mike Faehrmann. It is an *external,
optional* dependency: installed separately via ``pip install gallery-dl``,
invoked out-of-process (``sys.executable -m gallery_dl``), and **never
bundled** with this project. This module contains **no** gallery-dl code.

What this module does
---------------------
The Zerochan worker relies on gallery-dl's ``page-html`` extractor option for
categorized tags. Stock gallery-dl releases do not ship that option, so --
in *source* runs only -- this helper inserts that small enhancement into the
user's **own installed copy** of gallery-dl (with a ``.bak`` backup, only
when the option is missing). Nothing is shipped, nothing needs to be applied
by hand, and frozen (PyInstaller) builds skip patching entirely: they cannot
shell out to ``sys.executable -m gallery_dl`` anyway and always use the
built-in Zerochan JSON API fallback (Engine 2 in ``workers/zerochan.py``).

Because the modification happens on the user's machine at runtime, no
GPL-covered text is distributed with this repository.
"""

import os
import sys

# Anchor inside gallery-dl's ZerochanExtractor._parse_entry_html: the
# ``page_html`` assignment must land right before the author lookup.
_ANCHOR = '        try:\n            data["author"] = jsonld["author"]["name"]'

# Our own expression of the enhancement (not copied from anywhere).
_BLOCK = ('        if self.config("page-html"):\n'
          '            data["page_html"] = page\n'
          '\n')


def _gallery_dl_extractor_path():
    """Locate the installed gallery-dl Zerochan extractor, if any."""
    try:
        import gallery_dl  # external, optional, GPL-2.0-only
    except ImportError:
        return None
    try:
        site_dir = os.path.dirname(gallery_dl.__file__)
        target = os.path.join(site_dir, "extractor", "zerochan.py")
        if os.path.isfile(target):
            return target
    except Exception:
        pass
    return None


def ensure_zerochan_page_html(log=None):
    """Make sure the installed gallery-dl supports ``page-html``.

    Best-effort, never raises. Returns True when the installed extractor
    supports the option (already did, or was just patched).
    Frozen builds always return False so callers fall back to the
    built-in API engine.
    """
    def _say(msg):
        try:
            if log:
                log(msg)
        except Exception:
            pass

    if getattr(sys, "frozen", False):
        # Frozen desktop builds have no ``-m gallery_dl`` interpreter to
        # shell out to; the worker's built-in JSON engine is used instead.
        return False

    target = _gallery_dl_extractor_path()
    if not target:
        _say("gallery-dl Python package not found; will try gallery-dl "
             "binary / built-in API.")
        return False

    try:
        with open(target, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        _say(f"Could not read installed gallery-dl extractor ({e}); "
             "using stock extractor.")
        return False

    if "page-html" in content:
        return True

    anchor = _ANCHOR
    if anchor not in content:
        # Tolerate CRLF checkouts of site-packages.
        anchor_crlf = anchor.replace("\n", "\r\n")
        if anchor_crlf in content:
            anchor = anchor_crlf
            block = _BLOCK.replace("\n", "\r\n")
        else:
            _say("Installed gallery-dl layout is unfamiliar; using stock "
                 "extractor (built-in API fallback remains available).")
            return False
    else:
        block = _BLOCK

    try:
        bak = target + ".bak"
        if not os.path.isfile(bak):
            with open(bak, "w", encoding="utf-8") as f:
                f.write(content)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content.replace(anchor, block + anchor, 1))
        _say("Enabled page-html support in the installed gallery-dl "
             "Zerochan extractor.")
        return True
    except Exception as e:
        _say(f"Could not patch installed gallery-dl ({e}); using stock "
             "extractor.")
        return False
