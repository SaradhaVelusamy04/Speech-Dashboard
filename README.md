# EchoStream 🎙️

EchoStream is a modern, production-ready live Speech-to-Text (STT) web application. It securely captures audio from the user's microphone, streams it through a FastAPI backend proxy, and performs real-time transcription using [Deepgram's Nova-2 model](https://deepgram.com/). Authentication and user management are handled seamlessly via [Nhost](https://nhost.io/).

## ✨ Features

- **Live Real-time Transcription:** Powered by Deepgram Nova-2 for ultra-fast, highly accurate STT.
- **Secure Architecture:** Audio is proxied through a FastAPI WebSocket backend. API keys are never exposed to the client.
- **Robust Authentication:** Full login and signup flows implemented using the Nhost JS SDK.
- **Dynamic Audio Visualizer:** Smooth, responsive canvas-based audio visualization indicating mic activity.
- **Beautiful UI:** A modern, glassmorphism-inspired dark mode aesthetic built with plain CSS and HTML.

## 🛠️ Tech Stack

- **Backend:** Python 3, [FastAPI](https://fastapi.tiangolo.com/), Uvicorn, WebSockets.
- **Frontend:** Vanilla JS, HTML5, CSS3, MediaRecorder API.
- **Auth & Database:** [Nhost](https://nhost.io/) (PostgreSQL + Hasura Auth).
- **Speech-to-Text:** [Deepgram](https://deepgram.com/) (WebSocket API).

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- An [Nhost](https://nhost.io/) account and project.
- A [Deepgram](https://deepgram.com/) API key.

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd EchoStream
   ```

2. **Set up a Python virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   *(Ensure `fastapi`, `uvicorn`, `websockets`, and `python-dotenv` are installed).*

4. **Configure Environment Variables:**
   Create a `.env` file in the project root and add your credentials:
   ```env
   NHOST_SUBDOMAIN=your_nhost_subdomain
   NHOST_REGION=your_nhost_region
   DEEPGRAM_API_KEY=your_deepgram_api_key
   ```

### Running the Application

Start the FastAPI server:

```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Then, open your browser and navigate to: **http://127.0.0.1:8000**

## 📂 Project Structure

```text
.
├── .env                # Environment variables (do not commit)
├── main.py             # FastAPI backend proxy & WebSocket handler
├── requirements.txt    # Python dependencies
└── static/             # Frontend assets
    ├── index.html      # Main HTML interface
    ├── app.js          # Client-side logic, auth, and audio streaming
    └── style.css       # UI styling & animations
```

## 🔐 Security Considerations

- **API Keys:** The Deepgram API key is stored server-side. The frontend establishes a WebSocket connection with the FastAPI backend, which safely proxies the audio to Deepgram.
- **Authentication:** Users must sign up and sign in via Nhost before they are granted access to the recording dashboard.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 📝 License

This project is open-source and available under the [MIT License](LICENSE).
