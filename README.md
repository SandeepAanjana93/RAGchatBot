# File Chatbot

Upload a document, ask it questions, get answers grounded in what's actually written inside it — no hallucinated facts, no generic AI knowledge pretending to be your file.

This started as a simple "upload a PDF and chat with it" idea and slowly turned into a full RAG (Retrieval-Augmented Generation) pipeline with OCR support for scanned pages and code screenshots, multi-session chat history, and per-device data isolation so multiple people can use the same deployed instance without seeing each other's files.

**Live demo:** *(https://file-chatbot-omega.vercel.app/)*

![Dashboard interface](output/chat.png)
![Mobile interface](output/mobile.png)

## Why I built this

Most "chat with your PDF" tutorials only handle clean, text-based PDFs. The moment you throw a real-world document at them — a scanned report, a project file with code embedded as screenshots, a table-heavy spreadsheet export — they either extract garbage or nothing at all. I wanted something that could actually survive contact with messy files, so a chunk of the effort here went into the extraction layer rather than just wiring an LLM to a vector store.

## What it does

- **Upload documents** — PDF, DOCX, TXT, JPG, PNG
- **Smart text extraction** — pulls real text where it exists, and automatically falls back to OCR (Tesseract) for scanned pages or embedded images/code screenshots, without OCR-ing pages that don't need it
- **Table extraction** — tables in PDFs and DOCX files are parsed and kept in a readable row/column format instead of turning into a wall of jumbled text
- **Chat with your files** — ask questions and get answers pulled from the document's actual content, with the model explicitly told not to answer from its own general knowledge
- **Multiple chats, like a real chat app** — start new conversations, switch between them, each with its own history and auto-generated title
- **Background processing with live progress** — large files don't block the upload; you get a progress percentage while OCR runs in the background
- **Per-device data isolation** — no login system, but each browser gets a device ID so uploads and chats stay private to that device
- **Dark mode, mobile-responsive layout, copy-to-clipboard on answers** — the small stuff that makes it feel like a finished product instead of a prototype

## How it works

```
 Upload                          Ask a question
   │                                   │
   ▼                                   ▼
Extract text ──► Chunk ──► Embed   Embed the question
(pdfplumber +      │          │         │
 OCR fallback)     │          ▼         ▼
   │               │      ChromaDB ◄── similarity search
   ▼               │      (vector store)
Store raw file     │          │
in MongoDB         │          ▼
(GridFS)           │    Top matching chunks
   │               │          │
   ▼               ▼          ▼
Save metadata   Save chunk   Build prompt (context + question)
+ progress %    embeddings         │
                                   ▼
                            Gemini 3.5 Flash
                                   │
                                   ▼
                         Answer, grounded in the file
                        (chat history saved to MongoDB)
```

The short version: nothing gets "trained." Every uploaded file is broken into overlapping chunks, embedded, and stored in a vector database. When you ask a question, the app finds the chunks most relevant to that question and hands them to the LLM as context, along with a strict instruction to answer only from that context. This is the standard RAG pattern — the same idea behind tools like NotebookLM — just built from scratch here.

### The extraction pipeline, in a bit more detail

This is the part that took the most iteration:

1. Each PDF page is checked with `pdfplumber` first — if there's a real text layer, it's extracted directly, and any tables on that page are pulled out separately.
2. Every page is also scanned for embedded images above a certain size threshold. If a page has a large image (a code screenshot, a diagram, a scanned block of text) or has effectively no extractable text, that page is queued for OCR.
3. Only the pages that actually need it get converted to images and run through Tesseract — this keeps processing fast instead of OCR-ing every single page of a 60-page report just because it has a small logo on it.
4. Where possible, OCR runs on the cropped image region itself rather than the whole page, which noticeably improves accuracy on code screenshots.
5. All of this happens in a background task with a progress callback, so the frontend can show a live percentage instead of a frozen "uploading" spinner.

## Tech stack

**Backend**
- FastAPI (Python)
- MongoDB + GridFS — stores the original files and chat/session metadata
- ChromaDB — vector store for embeddings and similarity search
- pdfplumber, python-docx, Tesseract OCR, pdf2image, OpenCV — the extraction layer
- Google Gemini API — generates the actual answers

**Frontend**
- Next.js (App Router) + TypeScript
- Tailwind CSS
- No auth system — device-based session identity via `localStorage` + a UUID sent as a header on every request

**Deployment**
- Backend: Docker container on Render (Dockerfile installs `poppler-utils` and `tesseract-ocr` since these aren't available on the default Python image)
- Frontend: Vercel

## Project structure

```
RAGchatbot/
├── backend/
│   └── main.py              # FastAPI app — upload, OCR, chat, sessions, all of it
├── frontend/
│   └── app/
│       ├── page.tsx         # The whole UI — upload sidebar, chat window, dark mode
│       └── layout.tsx
├── Dockerfile                # Backend image w/ poppler + tesseract installed
├── requirements.txt
└── output/                   # Screenshots used in this README
```

## Running it locally

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # on Windows
# source venv/bin/activate     # on macOS/Linux

pip install -r ../requirements.txt
```

You'll also need two things installed system-wide for OCR to work:
- [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki)
- [Poppler](https://github.com/oschwartz10612/poppler-windows/releases) (Windows only — Linux typically has this via `poppler-utils`)

Create a `.env` file inside `backend/`:

```
MONGO_URI=your_mongodb_connection_string
GEMINI_API_KEY=your_gemini_api_key
```

Then run:

```bash
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Update the API base URL in `frontend/app/page.tsx` if you're pointing it at a local backend instead of the deployed one — it currently points at the production Render URL.

## Known limitations

Being upfront about what this doesn't do perfectly:

- OCR accuracy on code screenshots depends heavily on image quality — dense, syntax-highlighted code with small fonts can still come out with the occasional wrong character. Worth a manual double-check if you're copying code out for real use.
- No proper user accounts — device-based isolation is convenient but not "secure" in the auth sense. Clearing browser storage resets your session.
- Very large files (200+ pages, heavily scanned) will take a while to process even with parallel OCR, since Tesseract itself is the bottleneck.
- Free-tier hosting (Render) means the backend can spin down when idle — the first request after a while might be slow to wake it up.

## Possible next steps

- Proper authentication instead of device-ID isolation
- Support for XLSX/CSV and PPTX uploads
- Source citations in answers (which chunk/page an answer came from)
- Streaming responses instead of waiting for the full answer
- Swappable LLM provider instead of hardcoding one API

