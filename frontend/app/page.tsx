"use client";
import { useState, useRef, useEffect } from "react";

type ChatMessage = {
  sender: "user" | "ai";
  text: string;
};

type UploadedFile = {
  file_id: string;
  filename: string;
  size: number;
  upload_date: string;
  status?: string;
  progress?: number;
};

type ChatSession = {
  session_id: string;
  title: string;
  created_at: string;
};

const getFileIcon = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "📕";
  if (ext === "docx") return "📘";
  if (ext === "txt") return "📄";
  return "📎";
};

export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinking]);

  const fetchFiles = async () => {
    try {
      const res = await fetch("http://localhost:8000/files");
      const data = await res.json();
      setUploadedFiles(data.files);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch("http://localhost:8000/chats");
      const data = await res.json();
      setSessions(data.sessions);
      return data.sessions as ChatSession[];
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchSessionMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`http://localhost:8000/chats/${sessionId}/messages`);
      const data = await res.json();
      setMessages(data.messages);
    } catch (err) {
      console.error(err);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await fetch("http://localhost:8000/chats", { method: "POST" });
      const data = await res.json();
      await fetchSessions();
      setActiveSessionId(data.session_id);
      setMessages([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    await fetchSessionMessages(sessionId);
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Ye chat delete karni hai?")) return;

    try {
      await fetch(`http://localhost:8000/chats/${sessionId}`, { method: "DELETE" });
      const updatedSessions = await fetchSessions();

      if (activeSessionId === sessionId) {
        if (updatedSessions.length > 0) {
          setActiveSessionId(updatedSessions[0].session_id);
          await fetchSessionMessages(updatedSessions[0].session_id);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchFiles();
      const existingSessions = await fetchSessions();

      if (existingSessions.length > 0) {
        setActiveSessionId(existingSessions[0].session_id);
        await fetchSessionMessages(existingSessions[0].session_id);
      } else {
        await handleNewChat();
      }
    };
    init();
  }, []);

  // File processing status ko poll karta hai jab tak "ready" ya "error" na ho jaye
  const pollFileStatus = (fileId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8000/files/${fileId}/status`);
        const data = await res.json();

        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.file_id === fileId ? { ...f, status: data.status, progress: data.progress } : f
          )
        );

        if (data.status === "ready" || data.status === "error") {
          clearInterval(interval);
          await fetchFiles();
        }
      } catch (err) {
        clearInterval(interval);
        console.error(err);
      }
    }, 1500);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      await fetchFiles();
      pollFileStatus(data.file_id);
    } catch (err) {
      alert("File upload me error aa gaya. Backend chal raha hai check karo.");
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm("Ye file delete karni hai?")) return;
    try {
      await fetch(`http://localhost:8000/files/${fileId}`, { method: "DELETE" });
      await fetchFiles();
    } catch (err) {
      alert("Delete karne me error aa gaya.");
      console.error(err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !activeSessionId) return;

    const userMsg: ChatMessage = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    const questionText = input;
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: activeSessionId, question: questionText }),
      });

      const data = await res.json();
      setMessages((prev) => [...prev, { sender: "ai", text: data.answer }]);
      await fetchSessions();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: "⚠️ Kuch error aa gaya. Backend chal raha hai check karo." },
      ]);
      console.error(err);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#FAFAFB] text-[#1A1B23]">

      {/* Sidebar */}
      <div className="w-[280px] flex flex-col bg-gradient-to-b from-[#14141F] to-[#0D0D14] text-white">

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7C6FF6] to-[#5B4CE0] flex items-center justify-center font-bold text-sm shadow-lg shadow-[#7C6FF6]/30">
            FC
          </div>
          <h1 className="text-[15px] font-bold tracking-tight">File Chatbot</h1>
        </div>

        {/* New Chat */}
        <div className="px-4">
          <button
            onClick={handleNewChat}
            className="w-full bg-gradient-to-r from-[#7C6FF6] to-[#6D5DF6] hover:shadow-lg hover:shadow-[#7C6FF6]/25 transition-all text-sm font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <span className="text-base leading-none">+</span> New Chat
          </button>
        </div>

        {/* Chat Sessions */}
        <div className="mt-5 px-4 max-h-[32%] overflow-y-auto">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-2 tracking-wider px-1">
            Recent Chats
          </h3>
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li
                key={s.session_id}
                onClick={() => handleSelectSession(s.session_id)}
                className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[13px] cursor-pointer transition-all ${
                  activeSessionId === s.session_id
                    ? "bg-white/10 text-white"
                    : "hover:bg-white/5 text-gray-400"
                }`}
              >
                <span className="truncate">{s.title}</span>
                <button
                  onClick={(e) => handleDeleteSession(s.session_id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs transition-opacity flex-shrink-0"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-4 my-4 h-px bg-white/5" />

        {/* Drag & Drop Zone */}
        <div className="px-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-[1.5px] border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
              dragActive
                ? "border-[#7C6FF6] bg-[#7C6FF6]/10"
                : "border-white/15 hover:border-white/30 hover:bg-white/[0.02]"
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-300">
                <span className="dot w-1.5 h-1.5 rounded-full bg-[#7C6FF6]" />
                <span className="dot w-1.5 h-1.5 rounded-full bg-[#7C6FF6]" />
                <span className="dot w-1.5 h-1.5 rounded-full bg-[#7C6FF6]" />
                <span className="ml-1">Uploading</span>
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                <span className="text-lg block mb-1">📤</span>
                Drop file or <span className="text-[#9B8FFF]">browse</span>
              </p>
            )}
            <input ref={fileInputRef} type="file" name="fileUpload" id="fileUpload" onChange={handleFileChange} className="hidden" />
          </div>
        </div>

        {/* Uploaded Files */}
        <div className="mt-4 px-4 flex-1 overflow-y-auto pb-4">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-2 tracking-wider px-1">
            Documents · {uploadedFiles.length}
          </h3>

          {uploadedFiles.length === 0 ? (
            <p className="text-xs text-gray-600 px-1">No documents yet</p>
          ) : (
            <ul className="space-y-1.5">
              {uploadedFiles.map((file) => (
                <li
                  key={file.file_id}
                  className="flex items-center gap-2.5 bg-white/[0.03] rounded-lg p-2.5 text-xs hover:bg-white/[0.06] transition-colors group border border-white/[0.04]"
                >
                  <span className="text-base">{getFileIcon(file.filename)}</span>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate text-gray-200">{file.filename}</p>

                    {file.status === "processing" ? (
                      <div className="mt-1">
                        <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-[#7C6FF6] h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${file.progress || 0}%` }}
                          />
                        </div>
                        <p className="text-gray-500 text-[10px] mt-0.5">
                          Extracting... {file.progress || 0}%
                        </p>
                      </div>
                    ) : file.status === "error" ? (
                      <p className="text-red-400 text-[11px]">Processing failed</p>
                    ) : (
                      <p className="text-gray-500 text-[11px]">{formatSize(file.size)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteFile(file.file_id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity flex-shrink-0"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right side - Chat */}
      <div className="flex-1 flex flex-col relative">

        {/* Header */}
        <div className="border-b border-gray-100 px-8 py-4 bg-white/80 backdrop-blur-sm flex items-center justify-between">
          <div>
            <h2 className="font-bold text-[15px] text-[#1A1B23]">Chat with your files</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ask anything about your uploaded documents</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-5 max-w-3xl w-full mx-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7C6FF6]/10 to-[#5B4CE0]/10 flex items-center justify-center text-3xl">
                💬
              </div>
              <p className="text-gray-400 text-sm max-w-xs">
                Upload a document from the sidebar and start asking questions about it
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`msg-animate flex items-end gap-2.5 ${
                  msg.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.sender === "ai" && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7C6FF6] to-[#5B4CE0] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                    AI
                  </div>
                )}
                <div
                  className={`max-w-[75%] px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                    msg.sender === "user"
                      ? "bg-gradient-to-br from-[#7C6FF6] to-[#6D5DF6] text-white rounded-2xl rounded-br-md shadow-md shadow-[#7C6FF6]/20"
                      : "bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-bl-md shadow-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}

          {thinking && (
            <div className="msg-animate flex items-end gap-2.5 justify-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7C6FF6] to-[#5B4CE0] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                AI
              </div>
              <div className="bg-white border border-gray-100 px-4 py-3.5 rounded-2xl rounded-bl-md shadow-sm flex items-center gap-1.5">
                <span className="dot w-1.5 h-1.5 rounded-full bg-gray-400" />
                <span className="dot w-1.5 h-1.5 rounded-full bg-gray-400" />
                <span className="dot w-1.5 h-1.5 rounded-full bg-gray-400" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-8 pb-6 pt-2">
          <div className="max-w-3xl w-full mx-auto flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-2 shadow-sm focus-within:border-[#7C6FF6]/50 focus-within:ring-4 focus-within:ring-[#7C6FF6]/10 transition-all">
            <input
              type="text"
              name="chatMessage"
              id="chatMessage"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask a question about your documents..."
              className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-gray-400"
            />
            <button
              onClick={handleSend}
              disabled={thinking || !input.trim()}
              className="bg-gradient-to-r from-[#7C6FF6] to-[#6D5DF6] text-white text-sm font-semibold w-9 h-9 rounded-xl flex items-center justify-center hover:shadow-lg hover:shadow-[#7C6FF6]/25 transition-all disabled:opacity-30 disabled:shadow-none active:scale-95"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}