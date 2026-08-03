from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import io
from datetime import datetime
from pypdf import PdfReader
import docx
import chromadb
from sentence_transformers import SentenceTransformer
from pymongo import MongoClient
import gridfs
from bson import ObjectId
import requests
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- MongoDB Setup ----------
mongo_client = MongoClient(os.getenv("MONGO_URI"))
db = mongo_client["file_chatbot_db"]
fs = gridfs.GridFS(db)
files_collection = db["files_metadata"]
sessions_collection = db["chat_sessions"]
messages_collection = db["chat_messages"]

# ---------- Embedding + Vector DB ----------
embedder = SentenceTransformer("all-MiniLM-L6-v2")
chroma_client = chromadb.PersistentClient(path="chroma_db")
collection = chroma_client.get_or_create_collection(name="documents")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"


def extract_text(file_bytes: bytes, filename: str) -> str:
    ext = filename.split(".")[-1].lower()

    if ext == "pdf":
        reader = PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text

    elif ext == "docx":
        doc = docx.Document(io.BytesIO(file_bytes))
        return "\n".join([para.text for para in doc.paragraphs])

    elif ext == "txt":
        return file_bytes.decode("utf-8", errors="ignore")

    else:
        return ""


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50):
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks


@app.get("/")
def read_root():
    return {"message": "Backend chal raha hai 🚀"}


# ---------- File Upload ----------
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_bytes = await file.read()
    file_size = len(file_bytes)

    gridfs_id = fs.put(
        file_bytes,
        filename=file.filename,
        content_type=file.content_type
    )

    extracted_text = extract_text(file_bytes, file.filename)

    file_doc = {
        "filename": file.filename,
        "gridfs_id": gridfs_id,
        "file_size": file_size,
        "extracted_text": extracted_text,
        "upload_date": datetime.utcnow()
    }
    result = files_collection.insert_one(file_doc)
    file_id = str(result.inserted_id)

    chunks = chunk_text(extracted_text)

    if chunks:
        embeddings = embedder.encode(chunks).tolist()
        ids = [f"{file_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [{"filename": file.filename, "file_id": file_id, "chunk_index": i} for i in range(len(chunks))]

        collection.add(
            documents=chunks,
            embeddings=embeddings,
            ids=ids,
            metadatas=metadatas
        )

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": file_size,
        "message": "File successfully MongoDB me upload aur process ho gayi",
        "text_length": len(extracted_text),
        "chunks_created": len(chunks)
    }


@app.get("/files")
def list_files():
    files = files_collection.find({}, {"filename": 1, "file_size": 1, "upload_date": 1})
    result = []
    for f in files:
        result.append({
            "file_id": str(f["_id"]),
            "filename": f["filename"],
            "size": f["file_size"],
            "upload_date": f["upload_date"].isoformat()
        })
    return {"files": result}


@app.get("/files/{file_id}/download")
def download_file(file_id: str):
    file_doc = files_collection.find_one({"_id": ObjectId(file_id)})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File nahi mili")

    grid_file = fs.get(file_doc["gridfs_id"])
    return StreamingResponse(
        io.BytesIO(grid_file.read()),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={file_doc['filename']}"}
    )


@app.delete("/files/{file_id}")
def delete_file(file_id: str):
    file_doc = files_collection.find_one({"_id": ObjectId(file_id)})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File nahi mili")

    fs.delete(file_doc["gridfs_id"])
    collection.delete(where={"file_id": file_id})
    files_collection.delete_one({"_id": ObjectId(file_id)})

    return {"message": "File delete ho gayi"}


# ---------- Chat Sessions ----------
@app.post("/chats")
def create_chat_session():
    session_doc = {
        "title": "New Chat",
        "created_at": datetime.utcnow()
    }
    result = sessions_collection.insert_one(session_doc)
    return {
        "session_id": str(result.inserted_id),
        "title": "New Chat"
    }


@app.get("/chats")
def list_chat_sessions():
    sessions = sessions_collection.find().sort("created_at", -1)  # naye pehle
    result = []
    for s in sessions:
        result.append({
            "session_id": str(s["_id"]),
            "title": s["title"],
            "created_at": s["created_at"].isoformat()
        })
    return {"sessions": result}


@app.delete("/chats/{session_id}")
def delete_chat_session(session_id: str):
    sessions_collection.delete_one({"_id": ObjectId(session_id)})
    messages_collection.delete_many({"session_id": session_id})
    return {"message": "Chat delete ho gayi"}


@app.get("/chats/{session_id}/messages")
def get_session_messages(session_id: str):
    messages = messages_collection.find({"session_id": session_id}).sort("timestamp", 1)
    result = []
    for msg in messages:
        result.append({
            "sender": msg["sender"],
            "text": msg["text"]
        })
    return {"messages": result}


# ---------- Chat ----------
class ChatRequest(BaseModel):
    session_id: str
    question: str


@app.post("/chat")
async def chat(request: ChatRequest):
    question = request.question
    session_id = request.session_id

    messages_collection.insert_one({
        "session_id": session_id,
        "sender": "user",
        "text": question,
        "timestamp": datetime.utcnow()
    })

    # Agar ye session ka pehla message hai, to title update kar do (question se)
    existing_count = messages_collection.count_documents({"session_id": session_id})
    if existing_count == 1:
        title = question[:40] + ("..." if len(question) > 40 else "")
        sessions_collection.update_one(
            {"_id": ObjectId(session_id)},
            {"$set": {"title": title}}
        )

    question_embedding = embedder.encode([question]).tolist()

    results = collection.query(
        query_embeddings=question_embedding,
        n_results=5
    )

    relevant_chunks = results["documents"][0] if results["documents"] else []
    context = "\n\n---\n\n".join(relevant_chunks)

    if not context:
        answer = "Koi file upload nahi hui hai ya relevant information nahi mili. Pehle file upload karo."
        messages_collection.insert_one({
            "session_id": session_id,
            "sender": "ai",
            "text": answer,
            "timestamp": datetime.utcnow()
        })
        return {"answer": answer}

    prompt = f"""Neeche diye gaye document context ke base par user ke question ka answer do. Agar answer context me nahi hai, to saaf bata do ki information available nahi hai.

Context:
{context}

Question: {question}

Answer:"""

    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "meta/llama-3.1-8b-instruct",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
        "temperature": 0.5,
        "stream": False
    }

    try:
        response = requests.post(NVIDIA_URL, headers=headers, json=payload, timeout=30)
        result = response.json()

        if "choices" not in result:
            answer = f"AI se error aaya: {result}"
        else:
            answer = result["choices"][0]["message"]["content"]

        messages_collection.insert_one({
            "session_id": session_id,
            "sender": "ai",
            "text": answer,
            "timestamp": datetime.utcnow()
        })

        return {"answer": answer}

    except Exception as e:
        error_msg = f"Error: {str(e)}"
        messages_collection.insert_one({
            "session_id": session_id,
            "sender": "ai",
            "text": error_msg,
            "timestamp": datetime.utcnow()
        })
        return {"answer": error_msg}