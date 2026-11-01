#!/usr/bin/env python3
"""Local static server for RRET development.

`python -m http.server` keeps a listen backlog of 5, so a browser loading the
app's ES modules in parallel can get ERR_CONNECTION_RESET on some of them. This
is the same server with a larger backlog, threads, and no caching.

Usage: python3 scripts/dev_server.py [port]   (default 8085)
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8085
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with Server(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {root} at http://localhost:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
