# File Chatbot — AI Document Assistant

A full-stack Retrieval-Augmented Generation (RAG) application that allows users to upload documents (PDF, DOCX, TXT) and chat with an AI assistant to extract insights, code, and answers strictly based on the uploaded files. 

The AI is powered by **Moonshot Kimi-K3** (via Modal backend) capable of handling a 1 million token context window.

## 🚀 Features

- **Document Parsing & OCR**: Automatically extracts text from PDFs, Word docs, and TXT files. Uses `pytesseract` and `poppler` to perform OCR on scanned PDFs or image-based pages.
- **Vector Database**: Uses ChromaDB to store text embeddings for semantic search and fast retrieval.
- **File Storage**: Uses MongoDB GridFS to store uploaded files and conversation histories.
- **Premium UI**: Built with Next.js, featuring a modern dark/light mode toggle, glassmorphism UI, toast notifications, and smooth micro-animations.
- **Strict Context Responses**: The AI is strictly instructed to only answer from the uploaded context and provide code snippets exactly as written without hallucinating outside knowledge.

## 🛠️ Tech Stack

**Backend:**
- Python, FastAPI
- ChromaDB (Local Vector DB)
- MongoDB & GridFS (NoSQL Database)
- PyMuPDF, pdf2image, pytesseract, docx (Document Parsing & OCR)
- Sentence Transformers (Embeddings)
- Modal (Remote execution for LLM inference)

**Frontend:**
- Next.js (React)
- Tailwind CSS
- Inter Font (Google Fonts)

## 📦 Local Setup (Windows)

### Prerequisites
1. **Python 3.9+**
2. **Node.js 18+**
3. **MongoDB**: Have a local or Atlas MongoDB URI.
4. **Tesseract OCR**: Install Tesseract and ensure the path is set correctly in `backend/main.py`.
5. **Poppler**: Poppler binaries are included in the repository for Windows users.

### 1. Clone the repository
```bash
git clone https://github.com/SandeepAanjana93/RAGchatBot.git
cd RAGchatBot
```

### 2. Backend Setup
Activate the virtual environment and install dependencies:
```powershell
# Activate venv
.\chatbot\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file in the root directory:
```env
MONGO_URI=mongodb://localhost:27017/
MODAL_API_KEY=wk-your-workspace-token
```

Start the FastAPI server:
```powershell
cd backend
uvicorn main:app --reload
```

### 3. Frontend Setup
Open a new terminal and install Node dependencies:
```powershell
cd frontend
npm install
```

Start the Next.js development server:
```powershell
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## ☁️ Deployment (Linux / Cloud)

When deploying to a cloud provider like Render, Railway, or Heroku, the backend automatically detects the Linux OS and stops using the local Windows binaries for Poppler and Tesseract.

### Server Requirements
You must install `poppler-utils` and `tesseract-ocr` on your host machine. 
For example, in a Dockerfile or using apt:
```bash
apt-get update && apt-get install -y poppler-utils tesseract-ocr
```

### Starting the Server in Production
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```
