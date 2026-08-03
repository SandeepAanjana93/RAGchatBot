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
};

type ChatSession = {
  session_id: string;
  title: string;
  created_at: string;
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const fetchFiles = async () => {
    try {
      const res = await fetch("http://localhost:8000/files");
      const data = await res.json();
      setUploadedFiles(data.files);
    } catch (err) {
      console.error("Files fetch karne me error:", err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch("http://localhost:8000/chats");
      const data = await res.json();
      setSessions(data.sessions);
      return data.sessions as ChatSession[];
    } catch (err) {
      console.error("Sessions fetch karne me error:", err);
      return [];
    }
  };

  const fetchSessionMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`http://localhost:8000/chats/${sessionId}/messages`);
      const data = await res.json();
      setMessages(data.messages);
    } catch (err) {
      console.error("Messages fetch karne me error:", err);
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
      console.error("Naya chat banane me error:", err);
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

  // Page load hote hi: files, sessions fetch karo. Agar koi session nahi hai to nayi bana do.
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

      await fetchFiles();
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

      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: data.answer },
      ]);

      // Agar ye pehla message tha, to sidebar me title update karne ke liye sessions refresh karo
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
    <div className="flex h-screen bg-[#F7F8FA] font-sans">

      {/* Sidebar */}
      <div className="w-[300px] bg-[#161A23] text-white flex flex-col p-5">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-[#6D5DF6] flex items-center justify-center font-bold text-sm">
            FC
          </div>
          <h1 className="text-lg font-semibold">File Chatbot</h1>
        </div>

        {/* New Chat Button */}
        <button
          onClick={handleNewChat}
          className="mb-4 w-full bg-[#6D5DF6] hover:bg-[#5B4CE0] transition-colors text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2"
        >
          + New Chat
        </button>

        {/* Chat Sessions List */}
        <div className="mb-6 max-h-[35%] overflow-y-auto">
          <h3 className="text-xs uppercase text-gray-400 mb-2 tracking-wide">Chats</h3>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li
                key={s.session_id}
                onClick={() => handleSelectSession(s.session_id)}
                className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                  activeSessionId === s.session_id
                    ? "bg-[#6D5DF6]/20 text-white"
                    : "hover:bg-white/5 text-gray-300"
                }`}
              >
                <span className="truncate">{s.title}</span>
                <button
                  onClick={(e) => handleDeleteSession(s.session_id, e)}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs transition-opacity flex-shrink-0"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
            dragActive ? "border-[#6D5DF6] bg-[#6D5DF6]/10" : "border-gray-600 hover:border-gray-400"
          }`}
        >
          {uploading ? (
            <p className="text-xs text-gray-300">⏳ Upload ho raha hai...</p>
          ) : (
            <p className="text-xs text-gray-300">
              📄 File drag karo ya click karo
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Uploaded Files List */}
        <div className="mt-4 flex-1 overflow-y-auto">
          <h3 className="text-xs uppercase text-gray-400 mb-2 tracking-wide">
            Files ({uploadedFiles.length})
          </h3>

          {uploadedFiles.length === 0 ? (
            <p className="text-xs text-gray-500">Koi file nahi</p>
          ) : (
            <ul className="space-y-1.5">
              {uploadedFiles.map((file) => (
                <li
                  key={file.file_id}
                  className="flex items-center gap-2 bg-white/5 rounded-lg p-2 text-xs hover:bg-white/10 transition-colors group"
                >
                  <span>📄</span>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate">{file.filename}</p>
                    <p className="text-gray-400">{formatSize(file.size)}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteFile(file.file_id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right side - Chat Section */}
      <div className="flex-1 flex flex-col">

        <div className="border-b border-gray-200 px-6 py-4 bg-white">
          <h2 className="font-semibold text-gray-800">💬 Chat with your files</h2>
          <p className="text-xs text-gray-400">File upload karke uske baare me sawal pucho</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Koi file upload karo aur uske baare me sawal poochho 👋
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.sender === "user"
                      ? "bg-[#6D5DF6] text-white rounded-br-sm"
                      : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}

          {thinking && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 text-gray-400 px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm">
                AI soch raha hai...
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3 bg-[#F7F8FA] rounded-xl px-4 py-2.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Apna sawal likho..."
              className="flex-1 bg-transparent outline-none text-sm"
            />
            <button
              onClick={handleSend}
              disabled={thinking}
              className="bg-[#6D5DF6] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#5B4CE0] transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}