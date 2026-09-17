/* ===================================================================
   SCITECH PHOTOBOOTH — SCRIPT
   Sections: 1. State  2. Navigation  3. Setup screen  4. Camera
   5. Countdown & capture  6. Result screen & strip rendering
   7. Download  8. Retake / new session  9. Init
   =================================================================== */

(function () {
  "use strict";

  /* ---------- 1. STATE ---------- */
  const state = {
    photoCount: 3,
    countdownSeconds: 5,
    mirrored: true,
    stream: null,
    photos: [],       // data URLs, already mirrored/oriented as captured
    currentIndex: 0,
    frame: "tech",
    isCapturing: false,
  };

  /* ---------- shared element refs ---------- */
  const screens = {
    welcome: document.getElementById("screen-welcome"),
    setup: document.getElementById("screen-setup"),
    camera: document.getElementById("screen-camera"),
    result: document.getElementById("screen-result"),
  };

  const toastEl = document.getElementById("toast");
  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2400);
  }

  /* ---------- 2. NAVIGATION ---------- */
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("is-active", key === name);
    });
    window.scrollTo(0, 0);
  }

  /* ---------- 3. SETUP SCREEN ---------- */
  const choiceCards = document.querySelectorAll(".choice-card");
  choiceCards.forEach((card) => {
    card.addEventListener("click", () => {
      choiceCards.forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      state.photoCount = parseInt(card.dataset.count, 10);
    });
  });

  const pillChoices = document.querySelectorAll(".pill-choice");
  pillChoices.forEach((pill) => {
    pill.addEventListener("click", () => {
      pillChoices.forEach((p) => p.classList.remove("is-selected"));
      pill.classList.add("is-selected");
      state.countdownSeconds = parseInt(pill.dataset.seconds, 10);
    });
  });

  document.getElementById("btn-start").addEventListener("click", () => {
    showScreen("setup");
  });

  document.getElementById("btn-setup-back").addEventListener("click", () => {
    showScreen("welcome");
  });

  document.getElementById("btn-setup-continue").addEventListener("click", () => {
    state.photos = [];
    state.currentIndex = 0;
    buildDots();
    showScreen("camera");
    startCamera();
  });

  /* ---------- 4. CAMERA ---------- */
  const videoEl = document.getElementById("video");
  const canvasEl = document.getElementById("canvas");
  const stageEl = document.getElementById("stage");
  const cameraMessageEl = document.getElementById("camera-message");
  const photoCounterEl = document.getElementById("photo-counter");
  const shutterBtn = document.getElementById("btn-shutter");
  const dotsEl = document.getElementById("dots");

  function buildDots() {
    dotsEl.innerHTML = "";
    for (let i = 0; i < state.photoCount; i++) {
      const d = document.createElement("span");
      d.className = "dot";
      dotsEl.appendChild(d);
    }
    updateDots();
  }

  function updateDots() {
    const dots = dotsEl.querySelectorAll(".dot");
    dots.forEach((d, i) => {
      d.classList.toggle("is-done", i < state.photos.length);
      d.classList.toggle("is-current", i === state.photos.length);
    });
  }

  function updateCounter() {
    const current = Math.min(state.photos.length + 1, state.photoCount);
    const total = state.photoCount;
    photoCounterEl.textContent = "Photo " + pad2(current) + " / " + pad2(total);
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  async function startCamera() {
    cameraMessageEl.hidden = true;
    shutterBtn.disabled = false;
    updateCounter();

    if (!window.isSecureContext) {
      showCameraError(
        "Camera access requires a secure connection.",
        "Please open this photobooth over HTTPS (for example, a GitHub Pages link) rather than a plain http:// address."
      );
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError(
        "Camera access is not available.",
        "This browser does not support camera access. Please try an up-to-date version of Safari or Chrome."
      );
      return;
    }

    try {
      stopCamera(); // ensure no duplicate streams
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      state.stream = stream;
      videoEl.srcObject = stream;
      applyMirror();
      await videoEl.play().catch(() => {});
    } catch (err) {
      showCameraError(
        "Camera access is required to take photos.",
        "Please allow camera access in your browser settings, then reload this page. The photobooth must be opened through an HTTPS website."
      );
    }
  }

  function showCameraError(title, body) {
    cameraMessageEl.hidden = false;
    cameraMessageEl.querySelector(".camera-message-title").textContent = title;
    cameraMessageEl.querySelector(".camera-message-body").textContent = body;
    shutterBtn.disabled = true;
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
    videoEl.srcObject = null;
  }

  function applyMirror() {
    videoEl.classList.toggle("no-mirror", !state.mirrored);
  }

  document.getElementById("btn-flip").addEventListener("click", () => {
    state.mirrored = !state.mirrored;
    applyMirror();
  });

  document.getElementById("btn-camera-retry").addEventListener("click", startCamera);

  document.getElementById("btn-camera-cancel").addEventListener("click", () => {
    stopCamera();
    showScreen("setup");
  });

  /* ---------- 5. COUNTDOWN & CAPTURE ---------- */
  const countdownOverlay = document.getElementById("countdown-overlay");
  const countdownNumberEl = document.getElementById("countdown-number");
  const flashEl = document.getElementById("flash");

  shutterBtn.addEventListener("click", () => {
    if (state.isCapturing || !state.stream) return;
    runCountdownThenCapture();
  });

  function runCountdownThenCapture() {
    state.isCapturing = true;
    shutterBtn.disabled = true;
    let remaining = state.countdownSeconds;

    countdownOverlay.classList.add("is-active");
    tick();

    function tick() {
      countdownNumberEl.textContent = remaining > 0 ? String(remaining) : "";
      countdownNumberEl.classList.remove("is-ticking");
      // force reflow to restart animation
      void countdownNumberEl.offsetWidth;
      countdownNumberEl.classList.add("is-ticking");

      if (remaining <= 0) {
        countdownOverlay.classList.remove("is-active");
        capturePhoto();
        return;
      }
      remaining -= 1;
      setTimeout(tick, 1000);
    }
  }

  function capturePhoto() {
    const width = videoEl.videoWidth || 1280;
    const height = videoEl.videoHeight || 960;
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext("2d");

    ctx.save();
    if (state.mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, width, height);
    ctx.restore();

    const dataUrl = canvasEl.toDataURL("image/png");
    state.photos.push(dataUrl);

    flashEl.classList.remove("is-firing");
    void flashEl.offsetWidth;
    flashEl.classList.add("is-firing");

    updateDots();
    updateCounter();

    state.isCapturing = false;

    if (state.photos.length >= state.photoCount) {
      setTimeout(finishSession, 500);
    } else {
      shutterBtn.disabled = false;
    }
  }

  function finishSession() {
    stopCamera();
    showScreen("result");
    renderStrip();
  }

  /* ---------- 6. RESULT SCREEN & STRIP RENDERING ---------- */
  const stripCanvas = document.getElementById("strip-canvas");
  const frameCards = document.querySelectorAll(".frame-card");

  frameCards.forEach((card) => {
    card.addEventListener("click", () => {
      frameCards.forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      state.frame = card.dataset.frame;
      renderStrip();
    });
  });

  const FRAME_STYLES = {
    tech: {
      bg: "#171310",
      text: "#F7F1E6",
      accent: "#D4718C",
      caption: "#8C6B70",
      decorative: true,
    },
    pink: {
      bg: "#F3C4CE",
      text: "#171310",
      accent: "#D4718C",
      caption: "#8C6B70",
      decorative: true,
    },
    grid: {
      bg: "#F7F1E6",
      text: "#171310",
      accent: "#D4718C",
      caption: "#8C6B70",
      decorative: "grid",
    },
    clean: {
      bg: "#FFFDF9",
      text: "#171310",
      accent: "#8C6B70",
      caption: "#8C6B70",
      decorative: false,
    },
  };

  function renderStrip() {
    if (state.photos.length === 0) return;

    const style = FRAME_STYLES[state.frame] || FRAME_STYLES.tech;

    const photoW = 640;
    const gap = 26;
    const outerPad = 34;
    const photoH = Math.round(photoW * 0.75);
    const headerH = 90;
    const footerH = 110;

    const count = state.photos.length;
    const canvasW = photoW + outerPad * 2;
    const canvasH = headerH + count * photoH + (count - 1) * gap + footerH + outerPad * 2;

    stripCanvas.width = canvasW;
    stripCanvas.height = canvasH;
    const ctx = stripCanvas.getContext("2d");

    // background
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // grid decoration
    if (style.decorative === "grid") {
      ctx.strokeStyle = "rgba(23,19,16,0.08)";
      ctx.lineWidth = 1;
      const step = 24;
      for (let x = 0; x <= canvasW; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasH); ctx.stroke();
      }
      for (let y = 0; y <= canvasH; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasW, y); ctx.stroke();
      }
    }

    // subtle corner accents for tech/pink
    if (style.decorative === true) {
      ctx.fillStyle = style.accent;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(canvasW - 18, 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(18, canvasH - 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.font = "500 20px Georgia, serif";
      ctx.fillStyle = style.accent;
      ctx.globalAlpha = 0.35;
      ctx.fillText("</>", canvasW - 74, headerH - 26);
      ctx.globalAlpha = 1;
    }

    // header text
    ctx.textAlign = "center";
    ctx.fillStyle = style.accent;
    ctx.font = "600 15px 'Work Sans', sans-serif";
    ctx.fillText("SCITECH / PHOTO BOOTH", canvasW / 2, outerPad + 28);

    ctx.fillStyle = style.text;
    ctx.font = "500 26px 'Fraunces', Georgia, serif";
    ctx.fillText("SciTech", canvasW / 2, outerPad + 64);

    // photos
    let y = outerPad + headerH;
    const drawn = state.photos.map((src) => loadImage(src));

    Promise.all(drawn).then((imgs) => {
      imgs.forEach((img) => {
        drawCoverImage(ctx, img, outerPad, y, photoW, photoH, 14);
        y += photoH + gap;
      });

      // footer text
      const footerTop = canvasH - footerH - outerPad + 26;
      ctx.fillStyle = style.caption;
      ctx.font = "600 14px 'Work Sans', sans-serif";
      ctx.fillText("SOCIETY OF COMPUTING TECHNOLOGISTS", canvasW / 2, footerTop);

      ctx.font = "400 13px 'Work Sans', sans-serif";
      ctx.fillStyle = style.caption;
      const year = new Date().getFullYear();
      ctx.fillText("BSCS \u2022 SciTech Event \u2022 " + year, canvasW / 2, footerTop + 26);
    });
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = src;
    });
  }

  // draws an image cropped to cover a target box, with rounded corners
  function drawCoverImage(ctx, img, x, y, w, h, radius) {
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sx, sy, sw, sh;

    if (imgRatio > boxRatio) {
      sh = img.height;
      sw = sh * boxRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / boxRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }

    ctx.save();
    roundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 7. DOWNLOAD ---------- */
  document.getElementById("btn-download").addEventListener("click", () => {
    try {
      const url = stripCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = "scitech-photobooth.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Photo strip downloaded");
    } catch (err) {
      showToast("Couldn't download — try a different browser");
    }
  });

  /* ---------- 8. RETAKE / NEW SESSION ---------- */
  document.getElementById("btn-retake").addEventListener("click", () => {
    state.photos = [];
    state.currentIndex = 0;
    buildDots();
    showScreen("camera");
    startCamera();
  });

  document.getElementById("btn-new-session").addEventListener("click", () => {
    stopCamera();
    state.photos = [];
    state.currentIndex = 0;
    showScreen("welcome");
  });

  /* stop the camera if the tab is hidden/closed while it's live */
  window.addEventListener("beforeunload", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !screens.camera.classList.contains("is-active")) {
      stopCamera();
    }
  });

  /* ---------- 9. INIT ---------- */
  showScreen("welcome");
})();