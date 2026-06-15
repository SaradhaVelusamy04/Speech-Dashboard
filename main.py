"""
EchoStream — Live Speech-to-Text Backend
FastAPI server that proxies browser audio to Deepgram's real-time STT API
via WebSocket, and streams transcript results back to the client.
"""

import asyncio
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import websockets

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("echostream")

DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&smart_format=true"
    "&interim_results=true"
    "&punctuate=true"
    "&encoding=linear16"
    "&sample_rate=16000"
)

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------
app = FastAPI(title="EchoStream — Live Speech-to-Text")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    """Serve the single-page application."""
    return FileResponse("static/index.html")


@app.get("/api/config")
async def get_config():
    """
    Return non-secret configuration to the frontend so it can decide
    whether to show the API-key setup screen or proceed directly.
    """
    return {
        "nhostSubdomain": os.getenv("NHOST_SUBDOMAIN", "").strip(),
        "nhostRegion": os.getenv("NHOST_REGION", "").strip(),
        "hasDeepgramKey": bool(os.getenv("DEEPGRAM_API_KEY", "").strip()),
    }


# ---------------------------------------------------------------------------
# WebSocket Proxy: Browser  ⟷  Deepgram
# ---------------------------------------------------------------------------
@app.websocket("/ws/transcribe")
async def websocket_transcribe(
    websocket: WebSocket,
    apiKey: str = Query(default=None),
):
    """
    1. Accept the browser WebSocket.
    2. Open a second WebSocket to Deepgram.
    3. Relay audio chunks browser → Deepgram and transcript JSON Deepgram → browser.
    """
    dg_api_key = (apiKey or os.getenv("DEEPGRAM_API_KEY", "")).strip()

    await websocket.accept()

    if not dg_api_key:
        await websocket.send_json({"error": "Missing Deepgram API key. Configure it in settings."})
        await websocket.close(code=4001, reason="Missing API key")
        return

    headers = {"Authorization": f"Token {dg_api_key}"}

    try:
        async with websockets.connect(DEEPGRAM_URL, extra_headers=headers) as dg_ws:
            log.info("Deepgram WebSocket connected — signalling client.")
            await websocket.send_json({"status": "ready"})

            async def browser_to_deepgram():
                """Forward raw audio bytes from the browser to Deepgram."""
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        if data:
                            await dg_ws.send(data)
                except WebSocketDisconnect:
                    log.info("Browser disconnected.")
                except Exception as exc:
                    log.warning("browser→deepgram relay error: %s", exc)

            async def deepgram_to_browser():
                """Forward Deepgram transcript JSON back to the browser."""
                try:
                    async for message in dg_ws:
                        await websocket.send_text(message)
                except websockets.exceptions.ConnectionClosed:
                    log.info("Deepgram connection closed.")
                except Exception as exc:
                    log.warning("deepgram→browser relay error: %s", exc)

            await asyncio.gather(
                browser_to_deepgram(),
                deepgram_to_browser(),
            )

    except websockets.exceptions.InvalidStatusCode as exc:
        error_msg = f"Deepgram rejected the connection (HTTP {exc.status_code}). Check your API key."
        log.error(error_msg)
        try:
            await websocket.send_json({"error": error_msg})
            await websocket.close()
        except Exception:
            pass

    except Exception as exc:
        log.exception("Unexpected error in transcription proxy")
        try:
            await websocket.send_json({"error": str(exc)})
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Dev Entry Point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
