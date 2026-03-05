// ==UserScript==
// @name         Threads Reader - Đọc Bài Tự Động
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Tự động đọc các bài viết trên Threads (threads.com) sử dụng Web Speech API. Kế thừa từ extension đọc FB.
// @author       Bạn
// @match        *://*.threads.net/*
// @match        *://*.threads.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Minh20812/userscript_build_with_love/main/threads_reader.user.js
// @downloadURL  https://raw.githubusercontent.com/Minh20812/userscript_build_with_love/main/threads_reader.user.js
// ==/UserScript==

(function () {
  "use strict";

  // --- State ---
  let currentStatus = "idle"; // idle, reading, paused
  let utteranceQueue = [];
  let currentIndex = 0;
  let isSpeaking = false;
  let isPaused = false;
  let highlightedEl = null;
  let seenElements = new WeakSet();
  let seenTexts = new Set();
  let scrollCooldown = false;
  let uiCreated = false;

  // Config mặc định
  let opts = {
    rate: 1.2,
    pitch: 1.0,
    volume: 1.0,
    lang: "vi-VN",
    voiceURI: localStorage.getItem("__threads_reader_voice") || "",
  };

  // --- Inject UI ---
  function createUI() {
    console.log("[Threads Reader] Hàm createUI được gọi.");
    if (uiCreated) return;
    uiCreated = true;
    console.log("[Threads Reader] Tạo UI thành công.");
    const style = document.createElement("style");
    style.textContent = `
            .__reader_panel {
                position: fixed;
                bottom: 80px;
                right: 20px;
                background: #101010;
                color: #e0e0e0;
                border: 1px solid #333;
                border-radius: 12px;
                padding: 12px;
                z-index: 999999;
                font-family: system-ui, -apple-system, sans-serif;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 200px;
                transition: opacity 0.3s, transform 0.3s;
            }
            .__reader_panel.hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateY(10px);
            }
            .__reader_toggle {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #101010;
                color: #e0e0e0;
                border: 1px solid #333;
                border-radius: 50%;
                width: 48px;
                height: 48px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                cursor: pointer;
                z-index: 999999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                transition: transform 0.2s, background 0.2s;
            }
            .__reader_toggle:hover {
                transform: scale(1.1);
                background: #202020;
            }
            .__reader_btn {
                background: #fff;
                color: #000;
                border: none;
                padding: 8px 12px;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity 0.2s;
            }
            .__reader_btn:hover { opacity: 0.8; }
            .__reader_btn.stop { background: #ff3333; color: white; }
            .__reader_status { font-size: 11px; color: #888; text-align: center; margin-top: 4px; }
            .__reader_select { 
                background: #202020; color: #e0e0e0; border: 1px solid #444; 
                padding: 4px 6px; border-radius: 6px; font-size: 11px; width: 100%; outline: none;
            }
            @keyframes __reader_pulse_threads__ {
                0%   { outline-color: #3b82f6; background-color: rgba(59,130,246,0.1); }
                50%  { outline-color: #60a5fa; background-color: rgba(96,165,250,0.2); }
                100% { outline-color: #3b82f6; background-color: rgba(59,130,246,0.1); }
            }
            .__reader_active_th__ {
                outline: 2px solid #3b82f6 !important;
                outline-offset: 4px !important;
                border-radius: 5px !important;
                animation: __reader_pulse_threads__ 1.5s ease-in-out infinite !important;
            }
        `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.className = "__reader_panel";

    const btnToggle = document.createElement("button");
    btnToggle.className = "__reader_btn";
    btnToggle.innerText = "▶ Bắt Đầu Đọc";

    const btnStop = document.createElement("button");
    btnStop.className = "__reader_btn stop";
    btnStop.innerText = "⏹ Dừng";

    const status = document.createElement("div");
    status.className = "__reader_status";
    status.innerText = "Trạng thái: Chờ";

    // Events
    btnToggle.onclick = () => {
      if (currentStatus === "idle" || currentStatus === "stopped") {
        startReading();
        btnToggle.innerText = "⏸ Tạm Dừng";
        status.innerText = "Đang đọc...";
      } else if (currentStatus === "reading") {
        pauseReading();
        btnToggle.innerText = "▶ Tiếp Tục";
        status.innerText = "Tạm dừng";
      } else if (currentStatus === "paused") {
        resumeReading();
        btnToggle.innerText = "⏸ Tạm Dừng";
        status.innerText = "Đang đọc...";
      }
    };

    btnStop.onclick = () => {
      stopReading();
      btnToggle.innerText = "▶ Bắt Đầu Đọc";
      status.innerText = "Trạng thái: Đã dừng";
    };

    const selectWrap = document.createElement("div");
    const voiceSelect = document.createElement("select");
    voiceSelect.className = "__reader_select";
    selectWrap.appendChild(voiceSelect);

    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      voiceSelect.textContent = "";

      const vi = voices.filter((v) => v.lang.includes("vi"));
      const other = voices.filter((v) => !v.lang.includes("vi"));

      const gVi = document.createElement("optgroup");
      gVi.label = "Tiếng Việt";
      vi.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.voiceURI;
        o.textContent = v.name;
        gVi.appendChild(o);
      });
      if (vi.length > 0) voiceSelect.appendChild(gVi);

      const gOther = document.createElement("optgroup");
      gOther.label = "Khác";
      other.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.voiceURI;
        o.textContent = v.name;
        gOther.appendChild(o);
      });
      if (other.length > 0) voiceSelect.appendChild(gOther);

      // Khôi phục lựa chọn hoặc tự chọn NamMinh mặc định
      if (opts.voiceURI) {
        voiceSelect.value = opts.voiceURI;
      } else {
        const namMinh = voices.find((v) => v.name.includes("NamMinh"));
        if (namMinh) {
          voiceSelect.value = namMinh.voiceURI;
          opts.voiceURI = namMinh.voiceURI;
          localStorage.setItem("__threads_reader_voice", namMinh.voiceURI);
        }
      }
    }

    // Gọi tải giọng khi load xong hoặc khi có sự kiện voiceschanged
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();

    voiceSelect.addEventListener("change", (e) => {
      opts.voiceURI = e.target.value;
      localStorage.setItem("__threads_reader_voice", e.target.value);
    });

    panel.appendChild(selectWrap);
    panel.appendChild(btnToggle);
    panel.appendChild(btnStop);
    panel.appendChild(status);
    document.body.appendChild(panel);

    const toggleBtn = document.createElement("div");
    toggleBtn.className = "__reader_toggle";
    toggleBtn.innerText = "✖";
    toggleBtn.title = "Thu gọn/Mở rộng bảng điều khiển";

    let isPanelOpen = true;
    toggleBtn.onclick = () => {
      isPanelOpen = !isPanelOpen;
      if (isPanelOpen) {
        panel.classList.remove("hidden");
        toggleBtn.innerText = "✖";
      } else {
        panel.classList.add("hidden");
        toggleBtn.innerText = "📖";
      }
    };
    document.body.appendChild(toggleBtn);
  }

  // --- Threads Element Detection ---
  function countRealWords(text) {
    return text.split(/\s+/).filter((t) => /[\p{L}]/u.test(t)).length;
  }

  function scanNewSegments() {
    const newSegments = [];

    // Threads thường dùng thẻ span có dir="auto" để chứa nội dung text
    const elements = document.querySelectorAll('span[dir="auto"]');
    if (elements.length === 0) {
      console.log(
        "[Threads Reader] Cảnh báo: Không tìm thấy thẻ span[dir='auto'] nào trên trang!",
      );
    }

    elements.forEach((el) => {
      if (seenElements.has(el)) return;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;

      let text = (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || countRealWords(text) < 4) return; // Bỏ qua chữ ngắn, Menu, Reply count...
      if (seenTexts.has(text)) return;

      seenElements.add(el);
      seenTexts.add(text);
      const top = el.getBoundingClientRect().top + window.scrollY;
      newSegments.push({ el, text, top });
    });

    return newSegments.sort((a, b) => a.top - b.top);
  }

  // --- Core Reading Logic ---
  function highlightElement(el) {
    if (highlightedEl) highlightedEl.classList.remove("__reader_active_th__");
    if (!el) return;
    highlightedEl = el;
    el.classList.add("__reader_active_th__");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function scrollPageDown() {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
  }

  function tryLoadMore(onDone) {
    if (scrollCooldown) {
      if (onDone) onDone([]);
      return;
    }
    scrollCooldown = true;
    scrollPageDown();

    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const more = scanNewSegments();
      if (more.length > 0) {
        clearInterval(poll);
        utteranceQueue.push(...more);
        setTimeout(() => (scrollCooldown = false), 1000);
        if (onDone) onDone(more);
      } else if (attempts >= 10) {
        clearInterval(poll);
        setTimeout(() => (scrollCooldown = false), 1000);
        if (onDone) onDone([]);
      }
    }, 500);
  }

  function speakCurrent() {
    if (isSpeaking) return;
    isSpeaking = true;

    try {
      if (isPaused || currentStatus === "stopped") return;

      if (currentIndex >= utteranceQueue.length) {
        const more = scanNewSegments();
        if (more.length > 0) {
          utteranceQueue.push(...more);
        } else if (!scrollCooldown) {
          isSpeaking = false;
          tryLoadMore(() => {
            if (currentStatus === "reading") speakCurrent();
          });
          return;
        } else {
          stopReading();
          document.querySelector(".__reader_status").innerText = "Đã đọc hết";
          return;
        }
      }

      const segment = utteranceQueue[currentIndex];
      highlightElement(segment.el);

      // Strip Emojis
      let textToSpeak = segment.text
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
        .trim();
      if (!textToSpeak) {
        isSpeaking = false;
        currentIndex++;
        setTimeout(speakCurrent, 50);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = opts.lang;
      utterance.rate = opts.rate;
      utterance.pitch = opts.pitch;
      utterance.volume = opts.volume;

      // Find Microsoft NamMinh voice if available
      const voices = window.speechSynthesis.getVoices();
      if (opts.voiceURI) {
        const selectedVoice = voices.find((v) => v.voiceURI === opts.voiceURI);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      } else {
        const namMinhVoice = voices.find((v) => v.name.includes("NamMinh"));
        if (namMinhVoice) {
          utterance.voice = namMinhVoice;
        }
      }

      utterance.onend = () => {
        isSpeaking = false;
        if (!isPaused && currentStatus === "reading") {
          currentIndex++;
          speakCurrent();
        }
      };

      utterance.onerror = (e) => {
        isSpeaking = false;
        if (e.error !== "interrupted") {
          currentIndex++;
          speakCurrent();
        }
      };

      window.speechSynthesis.speak(utterance);
    } finally {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        isSpeaking = false;
      }
    }
  }

  function startReading() {
    console.log("[Threads Reader] Bắt đầu đọc bài...");
    window.speechSynthesis.cancel();
    seenElements = new WeakSet();
    seenTexts.clear();
    utteranceQueue = scanNewSegments();
    console.log(
      "[Threads Reader] Đã tìm thấy",
      utteranceQueue.length,
      "đoạn text.",
    );
    currentIndex = 0;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      let node = selection.getRangeAt(0).startContainer;
      if (node.nodeType === 3) node = node.parentNode;
      const selectedSpan = node.closest
        ? node.closest('span[dir="auto"]')
        : null;

      let foundIndex = -1;
      if (selectedSpan) {
        foundIndex = utteranceQueue.findIndex(
          (seg) =>
            seg.el === selectedSpan ||
            selectedSpan.contains(seg.el) ||
            seg.el.contains(selectedSpan),
        );
      }

      if (foundIndex === -1) {
        const selText = selection.toString().trim();
        if (selText.length > 5) {
          foundIndex = utteranceQueue.findIndex(
            (seg) => seg.text.includes(selText) || selText.includes(seg.text),
          );
        }
      }

      if (foundIndex !== -1) {
        currentIndex = foundIndex;
        console.log(
          "[Threads Reader] Đã tìm thấy vị trí text tô đen ở index:",
          currentIndex,
        );
      }
    }

    currentStatus = "reading";
    isPaused = false;

    if (utteranceQueue.length === 0) {
      document.querySelector(".__reader_status").innerText =
        "Không tìm thấy chữ";
      return;
    }
    speakCurrent();
  }

  function pauseReading() {
    if (currentStatus === "reading") {
      isPaused = true;
      currentStatus = "paused";
      window.speechSynthesis.pause();
    }
  }

  function resumeReading() {
    if (currentStatus === "paused") {
      isPaused = false;
      currentStatus = "reading";
      window.speechSynthesis.resume();
      setTimeout(() => {
        if (currentStatus === "reading" && !window.speechSynthesis.speaking)
          speakCurrent();
      }, 300);
    }
  }

  function stopReading() {
    currentStatus = "stopped";
    isPaused = false;
    isSpeaking = false;
    scrollCooldown = false;
    window.speechSynthesis.cancel();
    if (highlightedEl) highlightedEl.classList.remove("__reader_active_th__");
  }

  // Init UI
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      console.log("[Threads Reader] DOMContentLoaded - Đang tạo UI...");
      createUI();
    });
  } else {
    console.log("[Threads Reader] DOM ready - Đang tạo UI...");
    createUI();
  }
})();
