"use client";
import { useState, useRef, useEffect, useCallback } from "react";

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
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) setDarkMode(JSON.parse(saved));

    const savedToken = localStorage.getItem('token');
    const savedUsername = localStorage.getItem('username');
    if (savedToken) {
      setToken(savedToken);
      setUsername(savedUsername);
    }
  }, []);

  const getHeaders = (isJson = false) => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (isJson) headers["Content-Type"] = "application/json";
    return headers;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/signup";
    try {
      const res = await fetch(`https://file-chatbot.onrender.com${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Authentication failed");
      
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      setToken(data.token);
      setUsername(data.username);
      showToast(isLoginMode ? "Logged in successfully" : "Account created successfully", "success");
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken(null);
    setUsername(null);
    setSessions([]);
    setMessages([]);
    setUploadedFiles([]);
    setActiveSessionId(null);
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('darkMode', JSON.stringify(next));
      return next;
    });
  };

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
      });
      // Store reject in a way the Cancel button can call it
      (window as unknown as Record<string, () => void>).__confirmReject = () => { setConfirmDialog(null); resolve(false); };
    });
  }, []);

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
      const res = await fetch("https://file-chatbot.onrender.com/files", { headers: getHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setUploadedFiles(data.files || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch("https://file-chatbot.onrender.com/chats", { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const s = data.sessions || [];
      setSessions(s);
      return s as ChatSession[];
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchSessionMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`https://file-chatbot.onrender.com/chats/${sessionId}/messages`, { headers: getHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await fetch("https://file-chatbot.onrender.com/chats", { method: "POST", headers: getHeaders() });
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
    const confirmed = await showConfirm("Are you sure you want to delete this chat?");
    if (!confirmed) return;

    try {
      await fetch(`https://file-chatbot.onrender.com/chats/${sessionId}`, { method: "DELETE", headers: getHeaders() });
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
      if (!localStorage.getItem("token")) return;
      
      // Ensure deviceId exists before fetching
      if (!localStorage.getItem("deviceId")) {
        localStorage.setItem("deviceId", crypto.randomUUID());
      }
      await fetchFiles();
      const existingSessions = await fetchSessions();

      if (existingSessions && existingSessions.length > 0) {
        setActiveSessionId(existingSessions[0].session_id);
        await fetchSessionMessages(existingSessions[0].session_id);
      } else {
        await handleNewChat();
      }
    };
    init();
  }, [token]);

  // Polls file processing status until it becomes "ready" or "error"
  const pollFileStatus = (fileId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`https://file-chatbot.onrender.com/files/${fileId}/status`, { headers: getHeaders() });
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

  const handleSend = async () => {
    if (!input.trim()) return;
    
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      // Auto-create a session if none is active
      try {
        const res = await fetch("https://file-chatbot.onrender.com/chats", { method: "POST", headers: getHeaders() });
        const data = await res.json();
        currentSessionId = data.session_id;
        setActiveSessionId(currentSessionId);
        await fetchSessions();
      } catch (err) {
        console.error("Failed to create new session", err);
        return;
      }
    }

    const userMsg: ChatMessage = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    const questionText = input;
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("https://file-chatbot.onrender.com/chat", {
        method: "POST",
        headers: getHeaders(true),
        body: JSON.stringify({ session_id: currentSessionId, question: questionText, file_id: selectedFileId }),
      });

      if (!res.ok) throw new Error("Chat request failed");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let firstToken = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.token) {
                fullText += data.token;

                if (firstToken) {
                  // Add AI message only when first token arrives
                  setThinking(false);
                  setMessages((prev) => [...prev, { sender: "ai", text: fullText }]);
                  firstToken = false;
                } else {
                  // Update the last AI message with new tokens
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      sender: "ai",
                      text: fullText,
                    };
                    return updated;
                  });
                }
              }

              if (data.done) {
                break;
              }
            } catch (e) {
              // ignore parse errors
            }
          }
        }
      }

      await fetchSessions();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: "⚠️ Something went wrong. Please check if the backend server is running.",
        },
      ]);
      console.error(err);
    } finally {
      setThinking(false);
    }
  };


  const handleDeleteFile = async (fileId: string) => {
    const confirmed = await showConfirm("Are you sure you want to delete this file?");
    if (!confirmed) return;
    try {
      await fetch(`https://file-chatbot.onrender.com/files/${fileId}`, { method: "DELETE", headers: getHeaders() });
      await fetchFiles();
    } catch (err) {
      showToast("Failed to delete the file. Please try again.", 'error');
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
      e.target.value = '';
    }
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("https://file-chatbot.onrender.com/upload", {
        method: "POST",
        headers: getHeaders(),
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      await fetchFiles();
      pollFileStatus(data.file_id);
    } catch (err) {
      showToast("File upload failed. Please check if the backend server is running.", 'error');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  
  if (!token) {
    return (
      <div className={`min-h-screen flex items-center justify-center transition-colors duration-300 ${darkMode ? 'bg-[#0B0C10] text-gray-200' : 'bg-[#FAFAFA] text-[#1A1B23]'}`}>
        <div className={`w-full max-w-md p-8 rounded-3xl shadow-xl border ${darkMode ? 'bg-[#1E1E2E] border-white/10' : 'bg-white border-gray-100'}`}>
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#E91E8C] to-[#F472B6] mx-auto flex items-center justify-center shadow-lg shadow-pink-500/30 mb-6 ai-avatar-glow">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#E91E8C] to-[#F472B6]">
              {isLoginMode ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="text-sm text-gray-400 mt-2">Sign in to access your secure RAG workspace</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-400">Username</label>
              <input
                type="text"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl outline-none transition-all ${darkMode ? 'bg-[#0B0C10] border border-white/10 focus:border-[#E91E8C] text-white' : 'bg-gray-50 border border-gray-200 focus:border-[#E91E8C]'}`}
                placeholder="Enter username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-400">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl outline-none transition-all ${darkMode ? 'bg-[#0B0C10] border border-white/10 focus:border-[#E91E8C] text-white' : 'bg-gray-50 border border-gray-200 focus:border-[#E91E8C]'}`}
                placeholder="Enter password"
                required
              />
            </div>

            {authError && <div className="text-red-500 text-sm text-center bg-red-500/10 py-2 rounded-lg">{authError}</div>}

            <button type="submit" className="w-full py-3.5 rounded-xl text-white font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98] send-ripple" style={{ background: 'linear-gradient(135deg, #E91E8C, #F472B6)', boxShadow: '0 4px 16px rgba(233, 30, 140, 0.3)' }}>
              {isLoginMode ? 'Sign In' : 'Sign Up'}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            {isLoginMode ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => setIsLoginMode(!isLoginMode)} className="text-[#E91E8C] font-semibold hover:underline">
              {isLoginMode ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen relative transition-colors duration-300 overflow-hidden ${darkMode ? 'bg-[#0D0D14] text-gray-100' : 'bg-[#FAFAFA] text-[#1A1B23]'}`}>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm transition-opacity" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-[280px] md:w-[300px]' : 'w-0'} absolute md:relative z-50 h-full overflow-hidden flex-shrink-0 transition-all duration-300 flex flex-col shadow-2xl md:shadow-none`}
        style={{ background: darkMode ? 'linear-gradient(180deg, #111122 0%, #0A0A12 100%)' : 'linear-gradient(180deg, #1A1B2E 0%, #0F0F1A 100%)' }}>

        {/* Logo / Brand */}
        <div className="flex items-center justify-between px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-extrabold text-sm text-white shadow-lg"
            style={{ background: 'linear-gradient(135deg, #E91E8C 0%, #F472B6 100%)', boxShadow: '0 4px 20px rgba(233, 30, 140, 0.35)' }}>
            FC
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight text-white">File Chatbot</h1>
            <p className="text-[10px] text-gray-500 font-medium">AI-Powered Document Chat</p>
          </div>
          </div>
          {/* Mobile Close Button */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-white/50 hover:text-white transition-colors p-1 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-4 mt-1">
          <button
            onClick={handleNewChat}
            className="w-full text-white text-sm font-semibold py-3 rounded-2xl flex items-center justify-center gap-2.5 active:scale-[0.97] transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, #E91E8C 0%, #F472B6 100%)', boxShadow: '0 4px 16px rgba(233, 30, 140, 0.3)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Chat Sessions */}
        <div className="mt-5 px-4 max-h-[20%] overflow-y-auto sidebar-scroll">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-2.5 tracking-widest px-1 flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Recent Chats
          </h3>
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li
                key={s.session_id}
                onClick={() => handleSelectSession(s.session_id)}
                className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-[13px] cursor-pointer transition-all ${
                  activeSessionId === s.session_id
                    ? "bg-white/10 text-white border border-white/[0.06]"
                    : "hover:bg-white/[0.04] text-gray-400"
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <span className="text-[#E91E8C] text-sm opacity-70">💬</span>
                  <span className="truncate">{s.title}</span>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(s.session_id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs transition-all flex-shrink-0 p-0.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>



        {/* Uploaded Files List */}
        <div className="mt-3 px-4 flex-1 min-h-[120px] overflow-y-auto pb-4 sidebar-scroll">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-2.5 tracking-widest px-1 flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Documents · {uploadedFiles.length}
          </h3>

          {uploadedFiles.length === 0 ? (
            <p className="text-xs text-gray-600 px-1">No documents yet</p>
          ) : (
            <ul className="space-y-1.5">
              {uploadedFiles.map((file) => (
                <li
                  key={file.file_id}
                  className="flex items-center gap-2.5 bg-white/[0.03] rounded-xl p-3 text-xs hover:bg-white/[0.06] transition-all group border border-white/[0.04]"
                >
                  <span className="text-base">{getFileIcon(file.filename)}</span>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate text-gray-200 font-medium">{file.filename}</p>

                    {file.status === "processing" ? (
                      <div className="mt-1.5">
                        <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="progress-bar h-1.5 rounded-full transition-all duration-300"
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
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all flex-shrink-0 p-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ─── Right Side: Chat Area ─── */}
      <div className="flex-1 flex flex-col relative min-w-0">

        {/* Header */}
        <div className={`border-b px-6 py-3.5 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 ${darkMode ? 'border-white/10 bg-[#14141F]/90' : 'border-[#EBEBEF] bg-white/90'}`}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`p-2 rounded-xl transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
            >
              <svg className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h2 className={`font-bold text-[15px] ${darkMode ? 'text-white' : 'text-[#1A1B23]'}`}>Chat with your files</h2>
              <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
                AI ready · {uploadedFiles.length} document{uploadedFiles.length !== 1 ? 's' : ''} loaded
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Dark/Light Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className={`p-2.5 rounded-xl transition-all ${darkMode ? 'hover:bg-white/10 text-yellow-400' : 'hover:bg-gray-100 text-gray-500'}`}
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #E91E8C, #F472B6)' }}>
              AI
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 max-w-3xl w-full mx-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-5">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
                style={{ background: 'rgba(233, 30, 140, 0.08)' }}>
                💬
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-[#1A1B23]'}`}>Start a conversation</h3>
                <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
                  Upload a document from the sidebar and ask any question. AI will find answers directly from your files.
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                {["What is this about?", "Summarize the doc", "Find key points"].map((q) => (
                  <button key={q}
                    onClick={() => { setInput(q); }}
                    className={`text-xs px-4 py-2 rounded-full border transition-all hover:border-[#E91E8C]/40 hover:text-[#E91E8C] hover:bg-[#E91E8C]/5 ${darkMode ? 'border-white/15 text-gray-400' : 'border-[#EBEBEF] text-gray-500'}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`msg-animate flex items-start gap-3 ${
                  msg.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {/* AI Avatar */}
                {msg.sender === "ai" && (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 mt-0.5 ai-avatar-glow"
                    style={{ background: 'linear-gradient(135deg, #E91E8C, #F472B6)' }}>
                    AI
                  </div>
                )}

                {/* Message Bubble */}
                <div className="max-w-[75%] flex flex-col gap-1.5">
                  <div
                    className={`px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                      msg.sender === "user"
                        ? "text-white rounded-2xl rounded-tr-md"
                        : darkMode
                          ? "bg-[#1E1E2E] border border-white/10 text-gray-200 rounded-2xl rounded-tl-md shadow-sm"
                          : "bg-white border border-[#EBEBEF] text-gray-800 rounded-2xl rounded-tl-md shadow-sm"
                    }`}
                    style={msg.sender === "user" ? {
                      background: 'linear-gradient(135deg, #E91E8C 0%, #F472B6 100%)',
                      boxShadow: '0 4px 16px rgba(233, 30, 140, 0.25)'
                    } : undefined}
                  >
                    {msg.text}
                  </div>

                  {/* Action icons below message */}
                  <div className={`flex items-center gap-1 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                    {/* Copy Button */}
                    <button
                      onClick={() => handleCopy(msg.text, idx)}
                      className="p-1.5 text-gray-400 hover:text-[#E91E8C] rounded-lg hover:bg-[#E91E8C]/5 transition-all cursor-pointer"
                      title="Copy message"
                    >
                      {copiedIdx === idx ? (
                        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>

                    {/* Thumbs Up (AI messages only) */}
                    {msg.sender === "ai" && (
                      <>
                        <button className="p-1.5 text-gray-400 hover:text-[#E91E8C] rounded-lg hover:bg-[#E91E8C]/5 transition-all cursor-pointer" title="Good response">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z" />
                          </svg>
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-[#E91E8C] rounded-lg hover:bg-[#E91E8C]/5 transition-all cursor-pointer" title="Share">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* User Avatar */}
                {msg.sender === "user" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 mt-0.5">
                    U
                  </div>
                )}
              </div>
            ))
          )}

          {/* Thinking Indicator */}
          {thinking && (
            <div className="msg-animate flex items-start gap-3 justify-start">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 ai-avatar-glow"
                style={{ background: 'linear-gradient(135deg, #E91E8C, #F472B6)' }}>
                AI
              </div>
              <div className={`px-5 py-4 rounded-2xl rounded-tl-md shadow-sm flex items-center gap-2 ${darkMode ? 'bg-[#1E1E2E] border border-white/10' : 'bg-white border border-[#EBEBEF]'}`}>
                <span className="dot w-2 h-2 rounded-full bg-[#E91E8C]" />
                <span className="dot w-2 h-2 rounded-full bg-[#E91E8C]" />
                <span className="dot w-2 h-2 rounded-full bg-[#E91E8C]" />
                <span className="text-xs text-gray-400 ml-2">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="px-6 pb-5 pt-2">
          {uploadedFiles.length > 0 && (
            <div className="max-w-3xl mx-auto mb-2 flex justify-end">
              <select
                value={selectedFileId || ""}
                onChange={(e) => setSelectedFileId(e.target.value || null)}
                className={`text-xs px-3 py-1.5 rounded-lg outline-none transition-all cursor-pointer ${
                  darkMode 
                    ? 'bg-[#1E1E2E] border border-white/10 text-gray-300 hover:border-white/20' 
                    : 'bg-white border border-[#EBEBEF] text-gray-600 hover:border-gray-300'
                }`}
              >
                <option value="">All Files</option>
                {uploadedFiles.map(f => (
                  <option key={f.file_id} value={f.file_id}>
                    {f.filename}
                  </option>
                ))}
              </select>
            </div>
          )}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className={`max-w-3xl w-full mx-auto flex items-center gap-3 rounded-2xl px-4 py-2 shadow-sm focus-within:border-[#E91E8C]/50 focus-within:shadow-[0_0_0_4px_rgba(233,30,140,0.08)] transition-all ${darkMode ? 'bg-[#1E1E2E] border border-white/10' : 'bg-white border border-[#EBEBEF]'}`}
          >
            {/* Attach Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-[#E91E8C] hover:bg-[#E91E8C]/5 rounded-xl transition-all"
              title="Attach file"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <input ref={fileInputRef} type="file" name="fileUpload" id="fileUpload" onChange={handleFileChange} className="hidden" />

            <input
              type="text"
              name="chatMessage"
              id="chatMessage"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className={`flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-gray-400 font-medium ${darkMode ? 'text-white' : 'text-[#1A1B23]'}`}
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              className="send-ripple text-white text-sm font-semibold w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-20 disabled:shadow-none active:scale-90"
              style={{
                background: (thinking || !input.trim()) ? '#d1d5db' : 'linear-gradient(135deg, #E91E8C, #F472B6)',
                boxShadow: (thinking || !input.trim()) ? 'none' : '0 4px 16px rgba(233, 30, 140, 0.3)',
              }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
          <p className="text-center text-[10px] text-gray-400 mt-2.5">
            AI responses are based on your uploaded documents only
          </p>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 toast-animate">
          <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-md border max-w-sm ${
            toast.type === 'error'
              ? darkMode ? 'bg-red-900/80 border-red-700/50 text-red-100' : 'bg-red-50 border-red-200 text-red-800'
              : toast.type === 'success'
                ? darkMode ? 'bg-green-900/80 border-green-700/50 text-green-100' : 'bg-green-50 border-green-200 text-green-800'
                : darkMode ? 'bg-[#1E1E2E]/90 border-white/10 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
          }`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              toast.type === 'error' ? 'bg-red-500/20' : toast.type === 'success' ? 'bg-green-500/20' : 'bg-[#E91E8C]/10'
            }`}>
              {toast.type === 'error' ? (
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : toast.type === 'success' ? (
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[#E91E8C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <p className="text-sm font-medium">{toast.message}</p>
            <button onClick={() => setToast(null)} className="ml-2 p-1 opacity-50 hover:opacity-100 transition-opacity flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { (window as unknown as Record<string, () => void>).__confirmReject?.(); }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className={`relative toast-animate rounded-3xl p-6 shadow-2xl border max-w-sm w-full mx-4 ${
              darkMode ? 'bg-[#1E1E2E] border-white/10' : 'bg-white border-gray-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(233, 30, 140, 0.1)' }}>
              <svg className="w-6 h-6 text-[#E91E8C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className={`text-center font-bold text-base mb-1 ${darkMode ? 'text-white' : 'text-[#1A1B23]'}`}>Confirm Action</h3>
            <p className={`text-center text-sm mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => { (window as unknown as Record<string, () => void>).__confirmReject?.(); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                  darkMode ? 'bg-white/10 text-gray-300 hover:bg-white/15' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #E91E8C, #F472B6)', boxShadow: '0 4px 16px rgba(233, 30, 140, 0.3)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}