from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import io
import base64
from datetime import datetime
import pdfplumber
import docx
from pdf2image import convert_from_bytes
from PIL import Image
import cv2
import numpy as np
import chromadb

from pymongo import MongoClient
import gridfs
from bson import ObjectId
import requests
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytesseract

import os
import platform

load_dotenv(override=True)

# OS Check for Deployment
if os.name == 'nt':
    # Local Windows Paths
    POPPLER_PATH = r"C:\Users\Dell\Desktop\intern\python_projects\RAGchatbot\poppler-26.02.0\Library\bin"
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
else:
    # Linux / Server Deployment Paths (detected automatically via system PATH)
    POPPLER_PATH = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo_client = MongoClient(os.getenv("MONGO_URI"))
db = mongo_client["file_chatbot_db"]
fs = gridfs.GridFS(db)
files_collection = db["files_metadata"]
sessions_collection = db["chat_sessions"]
messages_collection = db["chat_messages"]


chroma_client = chromadb.PersistentClient(path="chroma_db")
collection = chroma_client.get_or_create_collection(name="documents")

MODAL_API_KEY = os.getenv("MODAL_API_KEY")
MODAL_URL = "https://sandeep67patel--ep-kimi-k3-server.us-west.modal.direct/v1/chat/completions"


def table_to_text(table) -> str:
    text = ""
    for row in table:
        cleaned_row = [cell if cell else "" for cell in row]
        text += " | ".join(cleaned_row) + "\n"
    return text


def pil_image_to_base64(pil_image: Image.Image) -> str:
    buffered = io.BytesIO()
    # Ensure RGB for JPEG conversion
    pil_image.convert("RGB").save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def run_ocr(pil_image: Image.Image) -> str:
    try:
        # Pytesseract works better on code screenshots when not adaptively thresholded
        # Just convert to grayscale to improve Tesseract accuracy slightly
        gray = pil_image.convert('L')
        text = pytesseract.image_to_string(gray)
        return text.strip()
    except Exception as e:
        print("Tesseract Error:", e)
        return ""


def process_single_page(args):
    """Ek page process karta hai — parallel execution ke liye banaya gaya"""
    page_num, page_text, table_text, needs_ocr, ocr_image, img_boxes = args

    combined = (page_text + "\n" + table_text).strip()

    if needs_ocr and ocr_image is not None:
        if img_boxes and len(img_boxes) > 0:
            for box in img_boxes:
                scale_x = ocr_image.width / box['page_width']
                scale_y = ocr_image.height / box['page_height']
                crop_box = (
                    int(box['x0'] * scale_x),
                    int(box['top'] * scale_y),
                    int(box['x1'] * scale_x),
                    int(box['bottom'] * scale_y)
                )
                try:
                    cropped_img = ocr_image.crop(crop_box)
                    ocr_text = run_ocr(cropped_img)
                    if len(ocr_text.strip()) > 5:
                        combined = combined + "\n[IMAGE/CODE CONTENT]\n" + ocr_text.strip()
                except Exception as e:
                    print("Crop error:", e)
        else:
            ocr_text = run_ocr(ocr_image)
            if len(ocr_text.strip()) > 5:
                combined = combined + "\n[IMAGE/CODE CONTENT]\n" + ocr_text.strip()

    return page_num, combined


def extract_text_from_pdf(file_bytes: bytes, progress_callback=None) -> str:
    page_data = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total_pages = len(pdf.pages)
        page_area_cache = {}

        # Step 1: First decide which pages need OCR (fast, sequential)
        needs_ocr_flags = []
        page_image_boxes = []
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            tables = page.extract_tables()
            table_text = ""
            for table in tables:
                table_text += "\n[TABLE]\n" + table_to_text(table) + "\n"

            combined = (page_text + "\n" + table_text).strip()
            
            boxes = []
            if len(page.images) > 0:
                for img in page.images:
                    if (img["width"] * img["height"]) > (page.width * page.height * 0.01):
                        boxes.append({
                            'x0': img['x0'], 'top': img['top'], 'x1': img['x1'], 'bottom': img['bottom'],
                            'page_width': float(page.width), 'page_height': float(page.height)
                        })

            has_no_text = len(combined) < 20

            needs_ocr_flags.append(len(boxes) > 0 or has_no_text)
            page_image_boxes.append(boxes)
            page_data.append((page_text, table_text))

        # Step 2: Convert only the pages that need OCR into images
        ocr_images_map = {}
        if any(needs_ocr_flags):
            # Pass poppler_path only if it's set (Windows), else let it use system PATH (Linux)
            if POPPLER_PATH:
                all_images = convert_from_bytes(file_bytes, poppler_path=POPPLER_PATH, dpi=150)
            else:
                all_images = convert_from_bytes(file_bytes, dpi=150)
            for i, needs in enumerate(needs_ocr_flags):
                if needs and i < len(all_images):
                    ocr_images_map[i] = all_images[i]

        # Step 3: Parallel OCR — 4 pages ek saath process honge (sequential se kaafi tez)
        results = {}
        completed = 0

        tasks = [
            (i, page_data[i][0], page_data[i][1], needs_ocr_flags[i], ocr_images_map.get(i), page_image_boxes[i])
            for i in range(total_pages)
        ]

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(process_single_page, task): task[0] for task in tasks}

            for future in as_completed(futures):
                page_num, combined_text = future.result()
                results[page_num] = combined_text
                completed += 1

                if progress_callback:
                    percent = int((completed / total_pages) * 100)
                    progress_callback(percent)

        # Original page order me wapas jodo
        text = "\n\n".join(results[i] for i in range(total_pages))
        return text


def extract_text_from_docx(file_bytes: bytes) -> str:
    doc = docx.Document(io.BytesIO(file_bytes))
    text = ""
    for para in doc.paragraphs:
        text += para.text + "\n"
    for table in doc.tables:
        text += "\n[TABLE]\n"
        for row in table.rows:
            row_text = " | ".join([cell.text for cell in row.cells])
            text += row_text + "\n"
    return text


def extract_text_from_image(file_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(file_bytes))
    return run_ocr(img)


def extract_text(file_bytes: bytes, filename: str, progress_callback=None) -> str:
    ext = filename.split(".")[-1].lower()

    if ext == "pdf":
        return extract_text_from_pdf(file_bytes, progress_callback)
    elif ext == "docx":
        return extract_text_from_docx(file_bytes)
    elif ext == "txt":
        return file_bytes.decode("utf-8", errors="ignore")
    elif ext in ["jpg", "jpeg", "png"]:
        return extract_text_from_image(file_bytes)
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
    return {"message": "Backend is running 🚀"}


def process_file_background(file_id: str, file_bytes: bytes, filename: str):
    def update_progress(percent):
        files_collection.update_one(
            {"_id": ObjectId(file_id)},
            {"$set": {"progress": percent}}
        )

    try:
        extracted_text = extract_text(file_bytes, filename, progress_callback=update_progress)
        chunks = chunk_text(extracted_text)

        if chunks:
            ids = [f"{file_id}_chunk_{i}" for i in range(len(chunks))]
            metadatas = [{"filename": filename, "file_id": file_id, "chunk_index": i} for i in range(len(chunks))]
            # Using ChromaDB's default embedding function to save RAM
            collection.add(documents=chunks, ids=ids, metadatas=metadatas)

        files_collection.update_one(
            {"_id": ObjectId(file_id)},
            {"$set": {
                "extracted_text": extracted_text,
                "status": "ready",
                "progress": 100,
                "text_length": len(extracted_text),
                "chunks_created": len(chunks)
            }}
        )
    except Exception as e:
        files_collection.update_one(
            {"_id": ObjectId(file_id)},
            {"$set": {"status": "error", "error_message": str(e)}}
        )


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), background_tasks: BackgroundTasks = None, x_device_id: str = Header(...)):
    file_bytes = await file.read()
    file_size = len(file_bytes)

    gridfs_id = fs.put(file_bytes, filename=file.filename, content_type=file.content_type)

    file_doc = {
        "filename": file.filename,
        "gridfs_id": gridfs_id,
        "file_size": file_size,
        "extracted_text": "",
        "status": "processing",
        "progress": 0,
        "upload_date": datetime.utcnow(),
        "device_id": x_device_id
    }
    result = files_collection.insert_one(file_doc)
    file_id = str(result.inserted_id)

    background_tasks.add_task(process_file_background, file_id, file_bytes, file.filename)

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": file_size,
        "message": "File upload ho gayi, processing shuru hui",
        "status": "processing"
    }


@app.get("/files/{file_id}/status")
def get_file_status(file_id: str, x_device_id: str = Header(...)):
    file_doc = files_collection.find_one({"_id": ObjectId(file_id), "device_id": x_device_id})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File nahi mili")
    return {
        "status": file_doc.get("status", "unknown"),
        "progress": file_doc.get("progress", 0),
        "chunks_created": file_doc.get("chunks_created", 0),
        "text_length": file_doc.get("text_length", 0),
        "error_message": file_doc.get("error_message", None)
    }


@app.get("/files")
def list_files(x_device_id: str = Header(...)):
    files = files_collection.find({"device_id": x_device_id}, {"filename": 1, "file_size": 1, "upload_date": 1, "status": 1, "progress": 1})
    result = []
    for f in files:
        result.append({
            "file_id": str(f["_id"]),
            "filename": f["filename"],
            "size": f["file_size"],
            "upload_date": f["upload_date"].isoformat(),
            "status": f.get("status", "ready"),
            "progress": f.get("progress", 100)
        })
    return {"files": result}


@app.get("/files/{file_id}/download")
def download_file(file_id: str, x_device_id: str = Header(...)):
    file_doc = files_collection.find_one({"_id": ObjectId(file_id), "device_id": x_device_id})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File nahi mili")
    grid_file = fs.get(file_doc["gridfs_id"])
    return StreamingResponse(
        io.BytesIO(grid_file.read()),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={file_doc['filename']}"}
    )


@app.delete("/files/{file_id}")
def delete_file(file_id: str, x_device_id: str = Header(...)):
    file_doc = files_collection.find_one({"_id": ObjectId(file_id), "device_id": x_device_id})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File nahi mili")
    fs.delete(file_doc["gridfs_id"])
    collection.delete(where={"file_id": file_id})
    files_collection.delete_one({"_id": ObjectId(file_id)})
    return {"message": "File delete ho gayi"}


@app.post("/chats")
def create_chat_session(x_device_id: str = Header(...)):
    session_doc = {"title": "New Chat", "created_at": datetime.utcnow(), "device_id": x_device_id}
    result = sessions_collection.insert_one(session_doc)
    return {"session_id": str(result.inserted_id), "title": "New Chat"}


@app.get("/chats")
def list_chat_sessions(x_device_id: str = Header(...)):
    sessions = sessions_collection.find({"device_id": x_device_id}).sort("created_at", -1)
    result = []
    for s in sessions:
        result.append({
            "session_id": str(s["_id"]),
            "title": s["title"],
            "created_at": s["created_at"].isoformat()
        })
    return {"sessions": result}


@app.delete("/chats/{session_id}")
def delete_chat_session(session_id: str, x_device_id: str = Header(...)):
    session_doc = sessions_collection.find_one({"_id": ObjectId(session_id), "device_id": x_device_id})
    if not session_doc:
        raise HTTPException(status_code=404, detail="Session not found")
    sessions_collection.delete_one({"_id": ObjectId(session_id)})
    messages_collection.delete_many({"session_id": session_id})
    return {"message": "Chat delete ho gayi"}


@app.get("/chats/{session_id}/messages")
def get_session_messages(session_id: str, x_device_id: str = Header(...)):
    session_doc = sessions_collection.find_one({"_id": ObjectId(session_id), "device_id": x_device_id})
    if not session_doc:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = messages_collection.find({"session_id": session_id}).sort("timestamp", 1)
    result = []
    for msg in messages:
        result.append({"sender": msg["sender"], "text": msg["text"]})
    return {"messages": result}


class ChatRequest(BaseModel):
    session_id: str
    question: str


@app.post("/chat")
async def chat(request: ChatRequest, x_device_id: str = Header(...)):
    question = request.question
    session_id = request.session_id

    session_doc = sessions_collection.find_one({"_id": ObjectId(session_id), "device_id": x_device_id})
    if not session_doc:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        messages_collection.insert_one({
            "session_id": session_id, "sender": "user", "text": question, "timestamp": datetime.utcnow()
        })

        existing_count = messages_collection.count_documents({"session_id": session_id})
        if existing_count == 1:
            title = question[:40] + ("..." if len(question) > 40 else "")
            sessions_collection.update_one({"_id": ObjectId(session_id)}, {"$set": {"title": title}})

        # Query ChromaDB (it will embed automatically)
        results = collection.query(query_texts=[question], n_results=15)

        relevant_chunks = results["documents"][0] if results["documents"] else []
        context = "\n\n---\n\n".join(relevant_chunks)

        if not context:
            answer = "No files have been uploaded or no relevant information was found. Please upload a file first."
            messages_collection.insert_one({
                "session_id": session_id, "sender": "ai", "text": answer, "timestamp": datetime.utcnow()
            })
            return {"answer": answer}

        prompt = f"""You are a document assistant. The "Context" provided below is your ONLY source of knowledge.

STRICT RULES:
1. Answer ONLY based on what is written in the "Context" below.
2. Do NOT use any outside or general knowledge.
3. If the user asks about code, security, passwords, or encryption, carefully look for code snippets (like 'def', 'hashlib', 'pbkdf2', 'salt') in the context and provide them EXACTLY as they appear. Do not explain, just give the code.
4. If the answer is not found in the Context, clearly state: "This information was not found in the uploaded file."

Context:
{context}

Question: {question}

Answer:"""
        headers = {"Authorization": f"Bearer {MODAL_API_KEY}", "Content-Type": "application/json"}
        payload = {
            "model": "moonshotai/Kimi-K3",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1024,
            "temperature": 0.2,
            "stream": False
        }

        response = requests.post(MODAL_URL, headers=headers, json=payload, timeout=30)
        result = response.json()

        if "choices" not in result:
            answer = f"AI se error aaya: {result}"
        else:
            answer = result["choices"][0]["message"]["content"]

        messages_collection.insert_one({
            "session_id": session_id, "sender": "ai", "text": answer, "timestamp": datetime.utcnow()
        })
        return {"answer": answer}

    except Exception as e:
        error_msg = f"System Error: {str(e)}"
        messages_collection.insert_one({
            "session_id": session_id, "sender": "ai", "text": error_msg, "timestamp": datetime.utcnow()
        })
        return {"answer": error_msg}