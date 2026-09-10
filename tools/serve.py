#!/usr/bin/env python3
"""Winziger Entwicklungs-Server.

Wie `python3 -m http.server`, nur ohne Zwischenspeicher: der Browser holt
jede Datei wirklich neu. Ohne das zeigt ein Reload nach einer Änderung
gerne die alte Version — besonders bei den ES-Modulen in src/.
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):          # etwas ruhigere Ausgabe
        if "GET" in (fmt % args) and " 200 " in (fmt % args):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    # Reihenfolge: Argument, dann PORT aus der Umgebung, dann 8123.
    # Das PORT-Fallback ist dafür da, dass ein Werkzeug den Port
    # zuweisen kann, wenn 8123 schon belegt ist.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8123))
    handler = partial(NoCacheHandler, directory=".")
    print(f"TRON läuft auf http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
