"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import {
  FiSend, FiImage, FiTerminal, FiSearch,
  FiZap, FiLayout, FiUpload,
  FiPlus, FiSun, FiMoon, FiCheck, FiX, FiEdit2,
  FiArrowLeft, FiAlertCircle, FiCopy,
} from "react-icons/fi";
import { CgTerminal } from "react-icons/cg";
import { BiLoaderAlt } from "react-icons/bi";
import { RiRobot2Line, RiSparklingLine } from "react-icons/ri";
// import { useUser } from "@/context/UserContext";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import toast, { Toaster } from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PlanVisualizer from "./components/PlanVisualizer";
import Link from "next/link";
import { GoBook } from "react-icons/go";
import { VscLayoutSidebarLeftOff } from "react-icons/vsc";

const CanvasArea = dynamic(() => import("./CanvasArea"), { ssr: false });
const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then((mod) => mod.Prism),
  { ssr: false }
);
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { HiOutlineArrowUpTray, HiOutlineTrash } from "react-icons/hi2";
import Image from "next/image";


const API = "/api/v1/creative-agent";
const GENERATION_TOOL_NAMES = new Set([
  "generate_image",
  "generate_video",
  "image_to_video",
  "edit_image",
  "edit_video",
  "enhance_image",
]);

const formatTime = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateHeader = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const TypingDots = () => (
  <div className="typing-dots py-1.5 px-1">
    <span></span>
    <span></span>
    <span></span>
  </div>
);

export default function CreativeCanvas({
  user,
  theme: forcedTheme,
  setTheme: forcedSetTheme,
  creditConversionRate = 200,
  // Embed-mode props (set by the /embed/agent/[id] page).
  // When embedCode is truthy, the component:
  //   1. Sends `x-agent-embed-code: <code>` instead of a Bearer token.
  //   2. Tracks session_id in localStorage instead of the URL query string
  //      (the iframe URL stays at /embed/agent/<code>).
  //   3. Hides owner-only UI (sessions sidebar, profile menu, / links).
  embedCode = null,
  isEmbed = false,
  // Platform customization props:
  // navLinks: array of { icon, label, path } to show in the user dropdown menu.
  // If not provided, defaults to the muapiapp links (Explore, Top Up, etc.).
  navLinks = null,
  // userBalanceLabel: string like "$ 5.00" or "1200 credits" to show in the dropdown.
  // If not provided, falls back to "$ {user.balance}".
  userBalanceLabel = null,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inEmbedMode = isEmbed && !!embedCode;
  const embedStorageKey = inEmbedMode ? `muapi_agent_session_${embedCode}` : null;
  const notifiedGenerationEventsRef = useRef(new Set());
  const generationActivityEventIdsRef = useRef(new Set());
  const [embedSessionId, setEmbedSessionId] = useState(() => {
    if (typeof window === "undefined" || !embedStorageKey) return null;
    return window.localStorage.getItem(embedStorageKey) || null;
  });
  const sessionId = inEmbedMode ? embedSessionId : searchParams.get("session");

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeTasks, setActiveTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentSessionName, setCurrentSessionName] = useState("Creative Canvas");
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [skills, setSkills] = useState([]);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAssetsMenu, setShowAssetsMenu] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState(null);

  // Left Sidebar and Session Management
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState(null);

  // Layout resizing
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [showChat, setShowChat] = useState(true);
  const [prevWidth, setPrevWidth] = useState(350);
  const isResizing = useRef(false);

  const handleToggleSidebar = () => {
    if (showChat) {
      setPrevWidth(sidebarWidth);
      setSidebarWidth(0);
      setShowChat(false);
    } else {
      setSidebarWidth(prevWidth || 350);
      setShowChat(true);
    }
  };

  // Theme handling: Use props if provided, otherwise fallback to useTheme hook
  const { setTheme: nextSetTheme, resolvedTheme: nextResolvedTheme } = useTheme();
  const resolvedTheme = forcedTheme || nextResolvedTheme;
  const setTheme = forcedSetTheme || nextSetTheme;
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const syncedUrlsRef = useRef(new Set());
  const justCreatedSessionRef = useRef(false);
  const initialHandoffProcessed = useRef(false);

  const getHeaders = useCallback(() => {
    if (inEmbedMode) {
      return { "x-agent-embed-code": embedCode };
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [inEmbedMode, embedCode]);

  // Persist embed session_id across page reloads so the conversation resumes.
  const setActiveEmbedSession = useCallback((id) => {
    setEmbedSessionId(id);
    if (typeof window !== "undefined" && embedStorageKey) {
      if (id) window.localStorage.setItem(embedStorageKey, id);
      else window.localStorage.removeItem(embedStorageKey);
    }
  }, [embedStorageKey]);

  // Initialize
  useEffect(() => {
    setMounted(true);
    // In embed mode there's no concept of "switch to another session" â€” the
    // visitor only ever sees the one keyed by their localStorage. Skip the
    // sessions list fetch (which would also 403-on-allowed-origins or surface
    // sessions from other embeds spawned by the same owner).
    if (!inEmbedMode) fetchSessions();
    fetchSkills();
  }, []);

  // Handle initial query and skill from URL (Fallback only)
  useEffect(() => {
    if (!mounted || busy || initialHandoffProcessed.current) return;
    // Embed pages never have a / handoff URL â€” skip.
    if (inEmbedMode) {
      initialHandoffProcessed.current = true;
      return;
    }

    const q = searchParams.get("q");
    const skillName = searchParams.get("skill");
    const a = searchParams.get("a");

    if (!q && !skillName && !a) {
      initialHandoffProcessed.current = true;
      return;
    }

    // We only process URL parameters if the session is brand new AND history has loaded as empty or default.
    // Since the Dashboard now sends the message, this useEffect will typically see the user message in history
    // and correctly skip sending q again.
    const isNewSession = messages.length === 1 && messages[0].role === "assistant";
    
    if (isNewSession) {
      initialHandoffProcessed.current = true;

      let initialAtts = null;
      if (a) {
        initialAtts = a.split(",").map(label => ({ asset_label: label, kind: "image" }));
      }

      if (skillName && !activeSkill) {
        const found = skills.find(s => s.name === skillName);
        if (found) {
          setActiveSkill(found);
          if (q) {
            setTimeout(() => sendMessage(q, found, initialAtts), 10);
          }
        }
      } else if (q) {
        sendMessage(q, null, initialAtts);
      }

      // Cleanup URL once processed
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("q");
      newParams.delete("skill");
      newParams.delete("a");
      router.replace(`?${newParams.toString()}`, { scroll: false });
    } else if (messages.length > 1 || (messages.length === 1 && messages[0].role === "user")) {
      // If history already has messages, we consider the handoff "processed" by the backend.
      initialHandoffProcessed.current = true;
      
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("q");
      newParams.delete("skill");
      newParams.delete("a");
      router.replace(`?${newParams.toString()}`, { scroll: false });
    }
  }, [mounted, busy, messages, skills.length, searchParams]);

  useEffect(() => {
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    // Clear the sync-tracking set whenever the session changes so assets from
    // the new session are always painted to canvas (prevents stale URL leakage).
    syncedUrlsRef.current.clear();
    if (sessionId) {
      loadHistory();
      loadAssets();
      // Sync name if sessions are already loaded
      const current = sessions.find(s => s.id === sessionId);
      if (current) {
        setCurrentSessionName(current.name);
      } else {
        fetchSessions(); // Re-fetch to find the name if not in list
      }
    } else {
      setMessages([{ role: "assistant", content: `Hello ${user?.username || "User"} â€” what shall we create today?`, timestamp: new Date().toISOString() }]);
      setAssets([]);
      setCurrentSessionName("New Session");
    }
  }, [sessionId]); // Removed sessions from deps to avoid infinite loop if fetchSessions updates sessions

  const fetchSessions = async () => {
    try {
      const { data } = await axios.get(`${API}/sessions`, { headers: getHeaders() });
      setSessions(data);
      if (sessionId) {
        const current = data.find(s => s.id === sessionId);
        if (current) setCurrentSessionName(current.name);
      }
    } catch {}
  };

  const fetchSkills = async () => {
    try {
      const { data } = await axios.get(`${API}/agent-skills`, { headers: getHeaders() });
      setSkills(data);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
    }
  };

  const processEvent = (ev, msgIdx) => {
    const p = ev.payload || {};

    // Canvas mutation events â€” apply directly to the live canvas, don't push
    // them into the chat transcript.
    if (ev.type === "canvas_op") {
      const op = p.op;
      const args = p.args || {};
      const c = canvasRef.current;
      if (!c) return;
      if (op === "move" && typeof c.moveNode === "function") {
        c.moveNode(args.asset_id, args.x, args.y);
      } else if (op === "arrange" && typeof c.arrangeNodes === "function") {
        c.arrangeNodes(args.moves || []);
      }
      return;
    }

    const flat = (() => {
      switch (ev.type) {
        case "text":         return { type: "text", content: p.content };
        case "info":         return { type: "info", content: p.content };
        case "error":        return { type: "error", name: p.name, message: p.message };
        case "tool_call":    return { type: "tool_call", name: p.name, args: p.args };
        case "tool_result":  return { type: "tool_result", name: p.name, result: p.result, asset: p.asset };
        case "plan_propose": return { type: "plan_propose", title: p.title, nodes: p.nodes, total_credits: p.total_credits };
        default:             return { type: ev.type, ...p };
      }
    })();
    if (!flat) return;
    flat.job_id = ev.job_id || p.job_id;

    // If the job has already been approved or rejected, mark approval events as handled.
    if (ev.approved !== undefined && ev.approved !== null) {
      const isApproval = flat.type === "plan_propose" || (flat.type === "info" && (flat.content?.includes("approval") || flat.content?.includes("confirmation")));
      if (isApproval) {
        flat.handled = true;
      }
    }

    setMessages(prev => {
      const arr = [...prev];
      if (msgIdx < 0 || msgIdx >= arr.length) return arr;
      const m = { ...arr[msgIdx], events: [...(arr[msgIdx].events || [])] };
      if (m.events.find(e => e.id === ev.id)) return arr;
      
      // Update event and mark previous ones as handled if this is a result
      m.events.push({ ...flat, id: ev.id });
      if (flat.type === "text") m.content = (m.content || "") + (flat.content || "");
      
      // If this is an info-approval pill, hide it if we already have a plan for this job
      if (flat.type === "info" && (flat.content?.includes("approval") || flat.content?.includes("confirmation"))) {
        const hasPlan = m.events.some(e => e.job_id === flat.job_id && e.type === "plan_propose");
        if (hasPlan) flat.handled = true;
      }

      if (flat.type === "tool_result" || flat.type === "error") {
        m.events = m.events.map(e => 
          e.job_id === flat.job_id && (
            (e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))) ||
            (e.type === "plan_propose")
          )
            ? { ...e, handled: true }
            : e
        );
      }
      
      // If we just got a plan, hide any loose "Waiting for approval" pills for this job
      if (flat.type === "plan_propose") {
        m.events = m.events.map(e => 
          e.job_id === flat.job_id && e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))
            ? { ...e, handled: true }
            : e
        );
      }
      
      arr[msgIdx] = m;
      return arr;
    });

    const notificationKey = ev.id || [
      flat.job_id,
      flat.type,
   ×Þ;êÚ$z{-®éÜj×Æ–çWB ¢G—SÒ&f–ÆR" ¢6Æ74æÖSÒ&†–FFVâ" ¢&Vc×¶f–ÆT–çWE&VgÒ ¢66WCÒ&–ÖvRò¢Çf–FVòò¢ÆVF–òò¢ ¢öä6†ævS×¶†æFÆTf–ÆUWÆöGÐ¢óà¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢öä6Æ–6³×²‚’Óâf–ÆT–çWE&Vbæ7W'&VçCòæ6Æ–6²‚—Ð¢F—6&ÆVC×·WÆöF–æwÐ¢6Æ74æÖSÒ'ÓãR&÷VæFVB†÷fW#¦&rÖ&r×vRFW‡B×6V6öæF'’×FW‡BG&ç6—F–öâÖÆÂ ¢F—FÆSÒ%WÆöB–ÖvR ¢à¢Äf•WÆöB6—¦S×³gÒóà¢Âö'WGFöãà ¢ÆF—b ¢6Æ74æÖSÒ'&VÆF—fR ¢F$–æFWƒ×²ÓÐ¢öä&ÇW#×²†R’Óâ°¢–b‚Ræ7W'&VçEF&vWBæ6öçF–ç2†Rç&VÆFVEF&vWB’’°¢6WE6†÷u6¶–ÆÇ4ÖVçR†fÇ6R“°¢Ð¢×Ð¢à¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢öä6Æ–6³×²‚’Óâ6WE6†÷u6¶–ÆÇ4ÖVçR‚6†÷u6¶–ÆÇ4ÖVçR—Ð¢6Æ74æÖS×¶ÓãR&÷VæFVB†÷fW#¦&rÖ&r×vRG&ç6—F–öâÖÆÂfÆW‚—FV×2Ö6VçFW"vÓãP¢G·6†÷u6¶–ÆÇ4ÖVçRò&&rÖ&r×vRFW‡B×&–Ö'’6†F÷rÖ–ææW""¢'FW‡B×6V6öæF'’×FW‡B'ÖÐ¢F—FÆSÒ$vVçB6¶–ÆÇ2 ¢à¢Ävô&öö²6—¦S×³gÒóà¢Âö'WGFöãà ¢·6†÷u6¶–ÆÇ4ÖVçRbb€¢ÆF—b6Æ74æÖSÒ&'6öÇWFR&÷GFöÒÖgVÆÂÆVgBÓó"×G&ç6ÆFR×‚Óó"Ö"Ó2rÕ³3#…Ò&rÖ&rÖ6&B&÷&FW"&÷&FW"ÖF—f–FW"&÷VæFVB6†F÷rÓ'†Â¢ÓS÷fW&fÆ÷rÖ†–FFVâæ–ÖFRÖ–âfFRÖ–â6Æ–FRÖ–âÖg&öÒÖ&÷GFöÒÓ"GW&F–öâÓ##à¢ÆF—b6Æ74æÖSÒ'‚ÓB’Ó2&÷&FW"Ö"&÷&FW"ÖF—f–FW"fÆW‚—FV×2Ö6VçFW"§W7F–g’Ö&WGvVVâ&rÖ&r×vRó3#à¢ÆF—cà¢Æƒ26Æ74æÖSÒ'FW‡BÕ³'…ÒföçBÖ&öÆBFW‡B×&–Ö'’×FW‡BWW&66RG&6¶–ær×F–v‡B#äW‡W'B6¶–ÆÇ3Âöƒ3à¢ÂöF—cà¢ÄÆ–æ² ¢‡&VcÒ&‡GG3¢òö×V’æ’öFö72öFW6–vâÖvVçBÖ’ ¢F&vWCÒ%ö&Ææ²" ¢6Æ74æÖSÒ'FW‡BÕ³…ÒföçBÖ&öÆBFW‡B×&–Ö'’†÷fW#§VæFW&Æ–æRfÆW‚—FV×2Ö6VçFW"vÓ ¢à¢Ä6uFW&Ö–æÂ6—¦S×³Òóà¢’Fö70¢ÂôÆ–æ³à¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ&Ö‚Ö‚Óƒ÷fW&fÆ÷r×’ÖWFòÓãR67&öÆÆ&"×7V'FÆR#à¢·6¶–ÆÇ2æÖ‡6¶–ÆÂÓâ€¢Æ'WGFöà¢¶W“×·6¶–ÆÂææÖWÐ¢öä6Æ–6³×²‚’Óâ°¢6WD7F—fU6¶–ÆÂ‡6¶–ÆÂ“°¢6WE6†÷u6¶–ÆÇ4ÖVçR†fÇ6R“°¢FW‡F&V&Vbæ7W'&VçCòæfö7W2‚“°¢×Ð¢6Æ74æÖS×¶rÖgVÆÂfÆW‚—FV×2Ö6VçFW"vÓ2‚Ó2’Ó"ãR&÷VæFVB†÷fW#¦&rÖ&r×vRG&ç6—F–öâÖÆÂFW‡BÖÆVgBw&÷WG¶7F—fU6¶–ÆÃòææÖRÓÓÒ6¶–ÆÂææÖRò&&r×&–Ö'’óR&÷&FW"&÷&FW"×&–Ö'’"¢&&÷&FW"&÷&FW"×G&ç7&VçB'ÖÐ¢à¢ÆF—b6Æ74æÖS×¶rÓ‚‚Ó‚&÷VæFVBfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"G&ç6—F–öâÖ6öÆ÷'26†F÷r×6ÒG¶7F—fU6¶–ÆÃòææÖRÓÓÒ6¶–ÆÂææÖRò&&r×&–Ö'’FW‡B×v†—FR"¢&&rÖ&r×vRFW‡B×&–Ö'’&÷&FW"&÷&FW"ÖF—f–FW"w&÷WÖ†÷fW#¦&r×&–Ö'’w&÷WÖ†÷fW#§FW‡B×v†—FR'ÖÓà¢Å&•7&¶Æ–ætÆ–æR6—¦S×³gÒóà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ&fÆW‚ÓÖ–â×rÓ#à¢ÆF—b6Æ74æÖS×¶föçBÖ&öÆB6—FÆ—¦RFW‡BÕ³'…ÒG&ç6—F–öâÖ6öÆ÷'2G¶7F—fU6¶–ÆÃòææÖRÓÓÒ6¶–ÆÂææÖRò'FW‡B×&–Ö'’"¢'FW‡B×&–Ö'’×FW‡Bw&÷WÖ†÷fW#§FW‡B×&–Ö'’'ÖÓà¢·6¶–ÆÂææÖWÐ¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ'FW‡BÕ³…ÒFW‡B×6V6öæF'’×FW‡B×BÓãRÆ–æRÖ6Æ×Ó÷6—G’Ós—FÆ–2#ç·6¶–ÆÂæFW67&—F–öâÇÂ%7V6–Æ—¦VBv÷&¶fÆ÷r'ÓÂöF—cà¢ÂöF—cà¢Âö'WGFöãà¢’—Ð¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ'Ó"ãR&rÖ&r×vRóS&÷&FW"×B&÷&FW"ÖF—f–FW"FW‡BÖ6VçFW"#à¢Æ'WGFöâ ¢öä6Æ–6³×²‚’Óâ6WE6†÷u6¶–ÆÇ4ÖVçR†fÇ6R—Ð¢6Æ74æÖSÒ'FW‡BÕ³…ÒföçBÖ&öÆBFW‡B×6V6öæF'’×FW‡B†÷fW#§FW‡B×&–Ö'’×FW‡BG&ç6—F–öâÖ6öÆ÷'2 ¢à¢F—6Ö—70¢Âö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢—Ð¢ÂöF—cà¢ ¢ÆF—b ¢6Æ74æÖSÒ'&VÆF—fR ¢F$–æFWƒ×²ÓÐ¢öä&ÇW#×²†R’Óâ°¢–b‚Ræ7W'&VçEF&vWBæ6öçF–ç2†Rç&VÆFVEF&vWB’’°¢6WE6†÷t76WG4ÖVçR†fÇ6R“°¢Ð¢×Ð¢à¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢öä6Æ–6³×²‚’Óâ6WE6†÷t76WG4ÖVçR‚6†÷t76WG4ÖVçR—Ð¢6Æ74æÖS×¶ÓãR&÷VæFVB†÷fW#¦&rÖ&r×vRG&ç6—F–öâÖÆÂfÆW‚—FV×2Ö6VçFW"vÓãP¢G·6†÷t76WG4ÖVçRò&&rÖ&r×vRFW‡B×&–Ö'’6†F÷rÖ–ææW""¢'FW‡B×6V6öæF'’×FW‡B'ÖÐ¢F—FÆSÒ%6W76–öâ76WG2 ¢à¢Äf”–ÖvR6—¦S×³gÒóà¢Âö'WGFöãà ¢·6†÷t76WG4ÖVçRbb€¢ÆF—b6Æ74æÖSÒ&'6öÇWFR&÷GFöÒÖgVÆÂ&–v‡BÓÖ"Ó"rÓs"&rÖ&rÖ6&B&÷&FW"&÷&FW"ÖF—f–FW"&÷VæFVB6†F÷rÓ'†Â¢Ó3æ–ÖFRÖfFRÖ–â×W#à¢ÆF—b6Æ74æÖSÒ'Ó"Ö"Ó"&÷&FW"Ö"&÷&FW"ÖF—f–FW"FW‡BÕ³…ÒföçBÖ&öÆBFW‡B×6V6öæF'’×FW‡BfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö&WGvVVâ#à¢Ç7ãå6W76–öâ76WG3Â÷7ãà¢Ç7â6Æ74æÖSÒ&÷6—G’ÓS#ç¶76WG2æÆVæwF‡Ò—FV×3Â÷7ãà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ&Ö‚Ö‚Óƒ÷fW&fÆ÷r×’ÖWFò67&öÆÆ&"×7V'FÆRÓ"w&–Bw&–BÖ6öÇ2Ó2vÓ"#à¢¶76WG2æÆVæwF‚ÓÓÒò€¢ÆF—b6Æ74æÖSÒ&6öÂ×7âÓ2’Ó‚FW‡BÖ6VçFW"FW‡B×6V6öæF'’×FW‡BFW‡BÕ³…Ò—FÆ–2#äæò76WG2vVæW&FVB–WCÂöF—cà¢’¢€¢76WG2æÖ‚†76WBÂ’’Óâ€¢ÆF—b ¢¶W“×¶—Ð¢öä6Æ–6³×²†R’Óâ°¢Rç7F÷&÷vF–öâ‚“°¢6WD–çWB‡&WbÓâ&Wb²‡&Wbò""¢""’²76WBæ76WEöÆ&VÂ“°¢6WE6†÷t76WG4ÖVçR†fÇ6R“°¢FW‡F&V&Vbæ7W'&VçCòæfö7W2‚“°¢×Ð¢6Æ74æÖSÒ&w&÷W&VÆF—fR7V7B×7V&R&÷VæFVB&÷&FW"&÷&FW"ÖF—f–FW"÷fW&fÆ÷rÖ†–FFVâ&rÖ&r×vRóS†÷fW#¦&÷&FW"×&–Ö'’G&ç6—F–öâÖÆÂ7W'6÷"×ö–çFW" ¢à¢¶76WBæ¶–æBÓÓÒ&–ÖvR"bbÆ–Ör7&3×¶76WBçW&ÇÒ6Æ74æÖSÒ'rÖgVÆÂ‚ÖgVÆÂö&¦V7BÖ6÷fW""óçÐ¢¶76WBæ¶–æBÓÓÒ'f–FVò"bbÇf–FVò7&3×¶76WBçW&ÇÒ6Æ74æÖSÒ'rÖgVÆÂ‚ÖgVÆÂö&¦V7BÖ6÷fW""óçÐ¢¶76WBæ¶–æBÓÓÒ&VF–ò"bbÆF—b6Æ74æÖSÒ'rÖgVÆÂ‚ÖgVÆÂfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"&r×&–Ö'’óRFW‡B×&–Ö'’FW‡BÕ³‡…ÒföçBÖ&öÆBWW&66RG&6¶–ær×F–v‡B#äVF–óÂöF—cçÐ¢ ¢ÆF—b6Æ74æÖSÒ&'6öÇWFR–ç6WBÓ&rÖ&Æ6²óc÷6—G’Ów&÷WÖ†÷fW#¦÷6—G’ÓG&ç6—F–öâÖ÷6—G’fÆW‚fÆW‚Ö6öÂ—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"ÓFW‡BÖ6VçFW"#à¢Ç7â6Æ74æÖSÒ'FW‡BÕ³…ÒFW‡B×v†—FRföçBÖ&öÆBG'Væ6FRrÖgVÆÂÖ"Ó#ç¶76WBæ76WEöÆ&VÇÓÂ÷7ãà¢ÂöF—cà¢ÂöF—cà¢’¢—Ð¢ÂöF—cà¢ÂöF—cà¢—Ð¢ÂöF—cà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ#à¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢öä6Æ–6³×²‚’Óâ6VæDÖW76vR‚—Ð¢F—6&ÆVC×¶'W7’ÇÂ‚–çWBçG&–Ò‚’bbGF6†ÖVçG2æÆVæwF‚ÓÓÒ—Ð¢6Æ74æÖS×¶rÓ‚‚Ó‚&÷VæFVBÖgVÆÂfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"G&ç6—F–öâÖÆÂ6†F÷r×6ÒÖÂÓ¢G¶'W7’ÇÂ‚–çWBçG&–Ò‚’bbGF6†ÖVçG2æÆVæwF‚ÓÓÒ¢ò&&rÕ·f"‚ÒÖ&rÖ6&BÖ†÷fW"•ÒFW‡BÕ·f"‚Ò×FW‡BÖ×WFVB•Ò7W'6÷"Öæ÷BÖÆÆ÷vVB ¢¢&&r×&–Ö'’FW‡B×v†—FR†÷fW#§66ÆRÓR'ÖÐ¢à¢¶'W7’òÄ&”ÆöFW$ÇB6—¦S×³GÒ6Æ74æÖSÒ&æ–ÖFR×7–â"óâ¢Äf•6VæB6—¦S×³GÒóçÐ¢Âö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢ÂöF—cà¢ÂöF—cà¢ÂöF—cà¢ÂöÖ–ãà¢ÂöF—cà¢“°§Ð   ¢òò)H)HWfVçB–ÆÇ2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦6öç7BDôôÅô”4ôå2Ò°¢vVæW&FUö–ÖvS¢/	øê‚"ÂVF—Eö–ÖvS¢.)Èþûˆò"ÂvVæW&FU÷f–FVó¢/	øêÂ"À¢–ÖvU÷Fõ÷f–FVó¢/	øêR"ÂVF—E÷f–FVó¢/	øéîûˆò"ÂÆ—7–æ5÷f–FVó¢/	ù(²"À¢6öæ6E÷f–FV÷3¢/	ùIr"ÂvVæW&FUöVF–ó¢/	øëR"ÂVæ†æ6Uö–ÖvS¢.)Ê‚"À¢WÆöEöf–ÆS¢/	ù:B"ÂÆ—7EöÖöFVÇ3¢/	ù9¢"Â6µ÷W6W#¢.)Ù2"À¢&÷÷6U÷Æã¢/	ù8²"ÂÆ—7Eö76WG3¢/	ù8"ÂvWEö76WC¢/	ùHÒ"Â&VÖ–æ–æuö'VFvWC¢/	ù+"À§Ó° ¦gVæ7F–öâWfVçE–ÆÂ‡²WfVçBÒ’°¢–b†WfVçBçG—RÓÓÒ'FööÅö6ÆÂ"’&WGW&â€¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓãR‚Ó"ãR’ÓãR&÷VæFVB&r×&–Ö'’ó&÷&FW"&÷&FW"×&–Ö'’FW‡B×&–Ö'’FW‡BÕ³…Ò×BÓ6†F÷r×6Ò#à¢Ç7ãçµDôôÅô”4ôå5¶WfVçBææÖUÒÇÂ/	ùJr'ÓÂ÷7ãà¢Ç7â6Æ74æÖSÒ&föçB×6VÖ–&öÆB#ç¶WfVçBææÖWÓÂ÷7ãà¢ÂöF—cà¢“° ¢–b†WfVçBçG—RÓÓÒ'FööÅ÷&W7VÇB"’°¢6öç7Bö²ÒWfVçBç&W7VÇCòæö²ÓÒfÇ6S°¢6öç7BÖöFVÂÒWfVçBç&W7VÇCòæÖöFVÃ°¢–b†WfVçBææÖRÓÓÒ&6µ÷W6W""bbWfVçBç&W7VÇCòæ6µ÷W6W"’°¢6öç7B6†ö–6W2ÒWfVçBç&W7VÇBæ6†ö–6W2ÇÂµÓ°¢&WGW&â€¢ÆF—b6Æ74æÖSÒ'‚Ó2’Ó"&÷VæFVB&rÖ&r×vR&÷&FW"&÷&FW"×&–Ö'’FW‡BÕ³'…Ò×BÓ6†F÷r×6Ò#à¢ÆF—b6Æ74æÖSÒ&föçB×6VÖ–&öÆBFW‡B×&–Ö'’Ö"Ó#î)Ù2¶WfVçBç&W7VÇBçVW7F–öçÓÂöF—cà¢¶6†ö–6W2æÆVæwF‚âbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓ×BÓ#à¢¶6†ö–6W2æÖ‚†2Â’’Óâ€¢ÆF—b¶W“×¶—Ò6Æ74æÖSÒ'FW‡B×6V6öæF'’×FW‡B#ç¶’²Òâ¶7ÓÂöF—cà¢’—Ð¢ÂöF—cà¢—Ð¢ÆF—b6Æ74æÖSÒ'FW‡BÕ³…ÒFW‡B×6V6öæF'’×FW‡B×BÓãR—FÆ–2#å&WÇ’Fò6öçF–çVRãÂöF—cà¢ÂöF—cà¢“°¢Ð¢&WGW&â€¢ÆF—b6Æ74æÖS×¶fÆW‚—FV×2Ö6VçFW"vÓãR‚Ó"ãR’ÓãR&÷VæFVBFW‡BÕ³…Ò&÷&FW"×BÓ6†F÷r×6ÒG°¢ö°¢ò&&rÕ·f"‚ÒÖ6öÆ÷"×7V66W72Ö&r•ÒFW‡BÕ·f"‚ÒÖ6öÆ÷"×7V66W72•Ò&÷&FW"Õ·f"‚ÒÖ6öÆ÷"×7V66W72•Ò ¢¢&&rÕ·f"‚ÒÖ6öÆ÷"ÖW'&÷"Ö&r•ÒFW‡BÕ·f"‚ÒÖ6öÆ÷"ÖW'&÷"•Ò&÷&FW"Õ·f"‚ÒÖ6öÆ÷"ÖW'&÷"•Ò ¢ÖÓà¢¶ö²òÄf”6†V6²6—¦S×³Òóâ¢Äf•‚6—¦S×³ÒóçÐ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"fÆW‚ÓÖ–â×rÓ#à¢Ç7â6Æ74æÖSÒ&föçB×6VÖ–&öÆB#à¢¶ö°¢ò†WfVçBæ76WBòvVæW&FVBG¶WfVçBæ76WBæ¶–æGÖ¢FöæV¢¢f–ÆVFÐ¢Â÷7ãà¢¶ö²bbÖöFVÂbb€¢Ç7â6Æ74æÖSÒ'FW‡BÕ³—…ÒföçBÖ&öÆBWW&66RG&6¶–ær×F–v‡B÷6—G’Óƒ#à¢¶ÖöFVÇÐ¢Â÷7ãà¢—Ð¢²ö²bbWfVçBç&W7VÇCòæW'&÷"bb€¢Ç7â6Æ74æÖSÒ'FW‡BÕ³—…Ò÷6—G’ÓsG'Væ6FRÖ‚×rÕ³c…Ò"F—FÆS×¶WfVçBç&W7VÇBæW'&÷'Óà¢(k¢µ7G&–ær†WfVçBç&W7VÇBæW'&÷"’ç&WÆ6R‚õåÇr´W'&÷#¥Ç2¢ö’Â""’ç7V'7G&–ærƒÂc—Ð¢Â÷7ãà¢—Ð¢ÂöF—cà¢ÂöF—cà¢“°¢Ð ¢–b†WfVçBçG—RÓÓÒ'Æå÷&÷÷6R"’°¢–b†WfVçBæ†æFÆVB’&WGW&âçVÆÃ°¢&WGW&â€¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓ"#à¢ÅÆåf—7VÆ—¦W"Æã×¶WfVçGÒóà¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"‚Ó""Ó"#à¢Æ'WGFöâ ¢öä6Æ–6³×²‚’ÓâWfVçBæöä7F–öãòâ†WfVçBæ¦ö%ö–BÂ&&÷fR"—Ð¢6Æ74æÖSÒ&fÆW‚Ó’Ó"&÷VæFVB&r×&–Ö'’FW‡B×v†—FRFW‡BÕ³'…ÒföçBÖ&öÆB†÷fW#¦'&–v‡FæW72ÓG&ç6—F–öâÖÆÂfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"vÓ" ¢à¢Äf”6†V6²óâ&÷fRbW†V7WFP¢Âö'WGFöãà¢Æ'WGFöâ ¢öä6Æ–6³×²‚’ÓâWfVçBæöä7F–öãòâ†WfVçBæ¦ö%ö–BÂ'&V¦V7B"—Ð¢6Æ74æÖSÒ'‚ÓB’Ó"&÷VæFVB&rÖ&rÖ6&B&÷&FW"&÷&FW"ÖF—f–FW"FW‡B×6V6öæF'’×FW‡BFW‡BÕ³'…Ò†÷fW#¦&rÖ&r×vRG&ç6—F–öâÖÆÂ ¢à¢6æ6VÀ¢Âö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢“°¢Ð ¢–b†WfVçBçG—RÓÓÒ&–æfò"’°¢òò–bF†—2—2â&÷fÂ&WVW7BÂ6†V6²–bvR6†÷VÆB6†÷r'WGFöç2à¢òòvRfö–B6†÷v–ær'WGFöç2öâF†R–æfò–ÆÂ–bF†W&Rw2FWF–ÆVBÆå÷&÷÷6R ¢òò6&BÇ&VG’†æFÆ–ærF†R&÷fÂf÷"F†—2¦ö"à¢6öç7B—4&÷fÂÒWfVçBææVVG5ö&÷fÂÇÂWfVçBæ6öçFVçCòæ–æ6ÇVFW2‚%v—F–ærf÷"&÷fÂ"’ÇÂWfVçBæ6öçFVçCòæ–æ6ÇVFW2‚$v—F–ær6öæf—&ÖF–öâ"“°¢ ¢òò–b—Bw2Ç&VG’†æFÆVBÂvRÖ–v‡BvçBFò†–FR—B÷"6†÷r—B26–×ÆRÆ&VÀ¢–b†WfVçBæ†æFÆVBbb—4&÷fÂ’&WGW&âçVÆÃ° ¢&WGW&â€¢ÆF—b6Æ74æÖS×¶‚Ó2’Ó"&÷VæFVB&÷&FW"FW‡BÕ³…Ò×BÓ6†F÷r×6ÒfÆW‚—FV×2Ö6VçFW"§W7F–g’Ö&WGvVVâG°¢—4&÷fÂò&&r×&–Ö'’óR&÷&FW"×&–Ö'’"¢&&rÖ&r×vR&÷&FW"ÖF—f–FW" ¢ÖÓà¢ÆF—b6Æ74æÖS×¶fÆW‚—FV×2Ö6VçFW"vÓ"G¶—4&÷fÂò'FW‡B×&–Ö'’"¢'FW‡B×6V6öæF'’×FW‡B'ÖÓà¢¶—4&÷fÂòÄf”ÆW'D6—&6ÆR6—¦S×³GÒ6Æ74æÖSÒ&æ–ÖFR×VÇ6R"óâ¢Äf•FW&Ö–æÂ6—¦S×³'Ò6Æ74æÖSÒ&÷6—G’ÓS"óçÐ¢Ç7â6Æ74æÖSÒ&fÆW‚Ó#ç¶WfVçBæ6öçFVçGÓÂ÷7ãà¢ÂöF—cà¢¶—4&÷fÂbbWfVçBæ†æFÆVBbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓÖÂÓB#à¢Æ'WGFöâ ¢öä6Æ–6³×²‚’ÓâWfVçBæöä7F–öãòâ†WfVçBæ¦ö%ö–BÂ&&÷fR"—Ð¢6Æ74æÖSÒ'‚Ó"’Ó&÷VæFVB&r×&–Ö'’FW‡B×v†—FRFW‡BÕ³…ÒföçBÖ&öÆB†÷fW#¦'&–v‡FæW72ÓG&ç6—F–öâÖÆÂ ¢à¢&÷fP¢Âö'WGFöãà¢Æ'WGFöâ ¢öä6Æ–6³×²‚’ÓâWfVçBæöä7F–öãòâ†WfVçBæ¦ö%ö–BÂ'&V¦V7B"—Ð¢6Æ74æÖSÒ'‚Ó"’Ó&÷VæFVB&rÖ&rÖ6&B&÷&FW"&÷&FW"ÖF—f–FW"FW‡B×6V6öæF'’×FW‡BFW‡BÕ³…Ò†÷fW#¦&rÖ&r×vRG&ç6—F–öâÖÆÂ ¢à¢&V¦V7@¢Âö'WGFöãà¢ÂöF—cà¢—Ð¢ÂöF—cà¢“°¢Ð ¢–b†WfVçBçG—RÓÓÒ&W'&÷""’&WGW&â€¢ÆF—b6Æ74æÖSÒ'‚Ó"ãR’ÓãR&÷VæFVB&rÕ·f"‚ÒÖ6öÆ÷"ÖW'&÷"Ö&r•ÒFW‡BÕ·f"‚ÒÖ6öÆ÷"ÖW'&÷"•Ò&÷&FW"&÷&FW"Õ·f"‚ÒÖ6öÆ÷"ÖW'&÷"•ÒFW‡BÕ³…Ò×BÓ6†F÷r×6Ò#à¢)ØÂ¶WfVçBæÖW76vWÐ¢ÂöF—cà¢“° ¢&WGW&âçVÆÃ°§Ð 