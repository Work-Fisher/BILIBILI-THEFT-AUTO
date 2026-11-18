"""Start the local game after its HTTP port has been reserved."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
import webbrowser

class GameServer(ThreadingHTTPServer):
    allow_reuse_address = False


handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
try:
    server = GameServer(("127.0.0.1", 8778), handler)
except OSError:
    server = GameServer(("127.0.0.1", 0), handler)

with server:
    url = f"http://127.0.0.1:{server.server_port}/cn.html"
    print(f"VICE CITY AFTERGLOW   {url}", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
