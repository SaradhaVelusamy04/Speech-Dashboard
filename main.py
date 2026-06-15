import asyncio
import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import websockets

# Load environment variables
load_dotenv()

app = FastAPI(title="Live Speech-to-Text App")

# Verify static directory exists
if not os.path.exists("static"):
    os.makedirs("static")

# Serve static assets
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.get("/api/config")
async def get_config():
    return {
        "nhostSubdomain": os.getenv("NHOST_SUBDOMAIN", "").strip(),
        "nhostRegion": os.getenv("NHOST_REGION", "").strip(),
        "hasDeepgramKey": bool(os.getenv("DEEPGRAM_API_KEY", "").strip())
    }


@app.websocket("/ws/transcribe")
async def websocket_endpoint(websocket: WebSocket, apiKey: str = None):
    # Retrieve Deepgram API key from local environment, falling back to query param
    dg_api_key = apiKey or os.getenv("DEEPGRAM_API_KEY")
    
    if not dg_api_key or dg_api_key.strip() == "":
        await websocket.accept()
        await websocket.send_json({
            "error": "Deepgram API key is missing. Please configure it in the settings panel or .env file."
        })
        await websocket.close(code=4001)
        return

    await websocket.accept()
    
    # Establish WebSocket handshake with Deepgram API
    # Nova-2 is Deepgram's fastest, most accurate general-purpose model
    deepgram_url = "wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true"
    headers = {
        "Authorization": f"Token {dg_api_key}"
    }

    try:
        async with websockets.connect(deepgram_url, extra_headers=headers) as dg_ws:
            # Task to forward audio data from browser to Deepgram
            async def forward_audio_to_dg():
                try:
                    while True:
                        # Receive audio chunks as raw binary frames
                        data = await websocket.receive_bytes()
                        if len(data) > 0:
                            await dg_ws.send(data)
                except WebSocketDisconnect:
                    # Notify Deepgram of stream closure
                    try:
                        await dg_ws.send(json.dumps({"type": "CloseStream"}))
                    except:
                        pass
                except Exception as e:
                    print(f"Error in client receiver task: {e}")

            # Task to retrieve transcripts from Deepgram and forward to browser
            async def forward_transcript_to_browser():
                try:
                    async for message in dg_ws:
                        # Message is a JSON string from Deepgram
                        await websocket.send_text(message)
                except Exception as e:
                    print(f"Error in Deepgram receiver task: {e}")
                    try:
                        await websocket.send_json({"error": f"Deepgram stream error: {str(e)}"})
                    except:
                        pass

            # Run both loops concurrently
            await asyncio.gather(forward_audio_to_dg(), forward_transcript_to_browser())

    except Exception as e:
        print(f"Connection setup failed with Deepgram: {e}")
        try:
            await websocket.send_json({"error": f"Failed to connect to Deepgram API: {str(e)}"})
            await websocket.close(code=1011)
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    # Start the server on localhost:8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
