// YourRank landing interactive behaviors
(function () {
  "use strict";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Mobile navigation drawer toggle
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".marketing-page .links");
  if (toggle && links) {
    const closeMenu = () => {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && links.classList.contains("open")) {
        closeMenu();
        toggle.focus();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!links.classList.contains("open")) return;
      if (!links.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
  }

  // Sliding Navbar Pill Indicator
  const navList = document.getElementById("navLinksList");
  const navPill = document.getElementById("navPill");
  if (navList && navPill && !prefersReducedMotion) {
    const navItems = navList.querySelectorAll(".nav-item");
    navItems.forEach((item) => {
      item.addEventListener("mouseenter", () => {
        const rect = item.getBoundingClientRect();
        const parentRect = navList.getBoundingClientRect();
        navPill.style.width = `${rect.width}px`;
        navPill.style.transform = `translateX(${rect.left - parentRect.left}px)`;
        navPill.style.opacity = "1";
      });
    });
    navList.addEventListener("mouseleave", () => {
      navPill.style.opacity = "0";
    });
  }

  // One-time editorial section reveals. The class is added only when JS is
  // available, so the static Worker HTML remains fully readable without it.
  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    const revealTargets = document.querySelectorAll(
      ".marketing-page main > section:not(.hero-shell), .marketing-page .product-chapter"
    );
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("reveal", "is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -48px" });
    revealTargets.forEach((target) => {
      target.classList.add("reveal");
      revealObserver.observe(target);
    });
  }

  // Dynamic copyright year stamp
  const yr = document.getElementById("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());

  // Rotating animated headline text swap (2-line hero)
  const swapWrap = document.getElementById("heroWordSwap");
  if (swapWrap && !prefersReducedMotion) {
    const words = swapWrap.querySelectorAll(".hero-swap-word");
    let currentIdx = 0;
    setInterval(() => {
      if (document.hidden) return;
      const prevWord = words[currentIdx];
      currentIdx = (currentIdx + 1) % words.length;
      const nextWord = words[currentIdx];

      if (prevWord) {
        prevWord.classList.remove("is-active");
        prevWord.classList.add("is-exiting");
        setTimeout(() => prevWord.classList.remove("is-exiting"), 500);
      }
      if (nextWord) {
        nextWord.classList.add("is-active");
      }
    }, 2600);
  }

  // Hero scoreboard settlement motion
  const heroScoreboard = document.querySelector("[data-hero-settle]");
  if (heroScoreboard && !prefersReducedMotion) {
    requestAnimationFrame(() => {
      heroScoreboard.classList.add("is-settling");
    });
  }

  // Spotlight mouse cursor effect for cards
  if (!prefersReducedMotion) {
    document.querySelectorAll("[data-spotlight]").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
      });
    });
  }

  // 3D Tilt effect
  if (!prefersReducedMotion) {
    document.querySelectorAll("[data-tilt]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        el.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-2px)`;
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "perspective(1000px) rotateY(0deg) rotateX(0deg) translateY(0px)";
      });
    });
  }

  // Community loop pulse trigger & step interaction
  const communityLoop = document.querySelector("[data-community-loop]");
  if (communityLoop && !prefersReducedMotion) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            communityLoop.classList.remove("is-pulsing");
            void communityLoop.offsetWidth;
            communityLoop.classList.add("is-pulsing");
          }
        });
      },
      { threshold: 0.3 }
    );
    observer.observe(communityLoop);

    // Loop step hover highlighting nodes
    document.querySelectorAll("[data-loop-step]").forEach((card) => {
      const stepIdx = card.getAttribute("data-loop-step");
      const targetDot = document.getElementById(`loopNode${stepIdx}`);
      card.addEventListener("mouseenter", () => {
        if (targetDot) targetDot.classList.add("is-active");
      });
      card.addEventListener("mouseleave", () => {
        if (targetDot) targetDot.classList.remove("is-active");
      });
    });
  }

  // Interactive Live Scoreboard reordering & numeric easing
  const boardRows = document.getElementById("boardRows");
  const flipClock = document.getElementById("flipClock");
  const liveTickerText = document.getElementById("liveTickerText");

  const filterData = {
    daily: [
      { rank: "01", medalClass: "rank-badge-medal--gold", handle: "nightowl", tag: "VIP CHAMPION", pts: 12560, pct: "100%", av: "NO", avClass: "avatar--1", isLeader: true },
      { rank: "02", medalClass: "rank-badge-medal--silver", handle: "pixelpilot", tag: "TOP REDEEMER", pts: 9870, pct: "78%", av: "PP", avClass: "avatar--2", isUp: true },
      { rank: "03", medalClass: "rank-badge-medal--bronze", handle: "moxie_live", tag: "PRO VIEWER", pts: 7230, pct: "57%", av: "ML", avClass: "avatar--3" },
      { rank: "04", medalClass: "rank-badge-medal--num", medalNum: "4", handle: "arcade_ally", tag: "ACTIVE", pts: 6410, pct: "51%", av: "AA", avClass: "avatar--4" }
    ],
    weekly: [
      { rank: "01", medalClass: "rank-badge-medal--gold", handle: "pixelpilot", tag: "WEEKLY CUP LEAD", pts: 48920, pct: "100%", av: "PP", avClass: "avatar--2", isLeader: true },
      { rank: "02", medalClass: "rank-badge-medal--silver", handle: "nightowl", tag: "SEASON RUNNER", pts: 44100, pct: "90%", av: "NO", avClass: "avatar--1" },
      { rank: "03", medalClass: "rank-badge-medal--bronze", handle: "arcade_ally", tag: "STREAK 5X", pts: 38200, pct: "78%", av: "AA", avClass: "avatar--4", isUp: true },
      { rank: "04", medalClass: "rank-badge-medal--num", medalNum: "4", handle: "moxie_live", tag: "PRO VIEWER", pts: 31050, pct: "63%", av: "ML", avClass: "avatar--3" }
    ],
    alltime: [
      { rank: "01", medalClass: "rank-badge-medal--gold", handle: "nightowl", tag: "HALL OF FAME", pts: 184900, pct: "100%", av: "NO", avClass: "avatar--1", isLeader: true },
      { rank: "02", medalClass: "rank-badge-medal--silver", handle: "pixelpilot", tag: "FOUNDER TIER", pts: 162400, pct: "87%", av: "PP", avClass: "avatar--2" },
      { rank: "03", medalClass: "rank-badge-medal--bronze", handle: "moxie_live", tag: "TOP SUPPORTER", pts: 141200, pct: "76%", av: "ML", avClass: "avatar--3" },
      { rank: "04", medalClass: "rank-badge-medal--num", medalNum: "4", handle: "arcade_ally", tag: "LEGEND", pts: 119800, pct: "64%", av: "AA", avClass: "avatar--4" }
    ]
  };

  function renderRows(dataset) {
    if (!boardRows) return;
    boardRows.innerHTML = dataset.map((d) => `
      <li class="board-row ${d.isLeader ? "board-row--leader" : ""} ${d.isUp ? "board-row--up" : ""}">
        <span class="rank-badge-medal ${d.medalClass}">
          ${d.medalNum ? d.medalNum : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'}
        </span>
        <span class="rank mono">${d.rank}</span>
        <span class="movement ${d.isUp ? "" : "is-hidden"}" aria-label="Moved up">▲</span>
        <div class="avatar ${d.avClass}">${d.av}</div>
        <div class="player-info">
          <span class="handle">${d.handle}</span>
          <span class="player-tag mono">${d.tag}</span>
        </div>
        <div class="points-wrap">
          <span class="points mono">${d.pts.toLocaleString()}</span>
          <span class="pts-bar"><span style="width: ${d.pct}"></span></span>
        </div>
        <span class="credit-mark" aria-hidden="true"></span>
      </li>
    `).join("");
  }

  // Filter tabs
  document.querySelectorAll("[data-board-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-board-filter");
      document.querySelectorAll("[data-board-filter]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      if (filterData[mode]) {
        renderRows(filterData[mode]);
      }
    });
  });

  const recentEvents = [
    "pixelpilot redeemed 500 pts for VIP Chat Badge",
    "nightowl earned 1,250 pts from a community quest",
    "moxie_live earned 500 pts from a Kick Sub reward",
    "arcade_ally climbed to #04 on Stream Standings",
    "pixelpilot claimed Discord Champion Role"
  ];
  let eventIdx = 0;

  function reorderBoard() {
    if (!boardRows || document.hidden || prefersReducedMotion) return;
    const items = Array.from(boardRows.children);
    if (items.length < 2) return;

    // Trigger row flip animation
    const rowToMove = items[1];
    if (rowToMove) {
      rowToMove.classList.add("is-flipping");
      setTimeout(() => rowToMove.classList.remove("is-flipping"), 600);
    }

    // Animate point change with numeric count up
    const pointEl = rowToMove ? rowToMove.querySelector(".points") : null;
    if (pointEl) {
      const currentPts = parseInt(pointEl.textContent.replace(/,/g, ""), 10) || 9870;
      const targetPts = currentPts + 250;
      let start = currentPts;
      const step = Math.ceil((targetPts - currentPts) / 10);
      const timer = setInterval(() => {
        start += step;
        if (start >= targetPts) {
          start = targetPts;
          clearInterval(timer);
        }
        pointEl.textContent = start.toLocaleString();
      }, 30);
    }

    // Rotate ticker text
    if (liveTickerText) {
      eventIdx = (eventIdx + 1) % recentEvents.length;
      liveTickerText.style.opacity = "0";
      setTimeout(() => {
        liveTickerText.textContent = recentEvents[eventIdx];
        liveTickerText.style.opacity = "1";
      }, 200);
    }
  }

  // Countdown timer clock
  if (flipClock && !prefersReducedMotion) {
    let secondsLeft = 12;
    setInterval(() => {
      if (document.hidden) return;
      secondsLeft--;
      if (secondsLeft < 0) {
        secondsLeft = 12;
        reorderBoard();
      }
      const s = secondsLeft < 10 ? `0${secondsLeft}` : `${secondsLeft}`;
      flipClock.textContent = `00:${s}`;
    }, 1000);
  }

  // Interactive Simulation Tabs
  const tabButtons = document.querySelectorAll("[data-sim-tab]");
  const tabPanels = document.querySelectorAll("[data-sim-panel]");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-sim-tab");
      tabButtons.forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      tabPanels.forEach((p) => {
        const isMatch = p.getAttribute("data-sim-panel") === target;
        p.classList.toggle("is-active", isMatch);
        p.hidden = !isMatch;
      });
    });
  });

  // Simulated Viewer Redemption Flow
  const simRedeemBtn = document.getElementById("simRedeemBtn");
  const simViewerBal = document.getElementById("simViewerBal");
  const simShopItem = document.getElementById("simShopItem");
  const simFeedbackNote = document.getElementById("simFeedbackNote");
  let simBal = 1450;

  if (simRedeemBtn && simViewerBal && simFeedbackNote) {
    simRedeemBtn.addEventListener("click", () => {
      if (simBal >= 800) {
        simBal -= 800;
        simViewerBal.textContent = `${simBal.toLocaleString()} pts`;
        simViewerBal.style.color = "var(--ok)";
        if (simShopItem) simShopItem.classList.add("is-redeeming");
        simFeedbackNote.textContent = "✓ Redeemed! Balance updated & Discord notified.";
        simFeedbackNote.style.color = "var(--ok)";
        simRedeemBtn.disabled = true;
        simRedeemBtn.textContent = "Redemption Queued";

        setTimeout(() => {
          simBal = 1450;
          simViewerBal.textContent = `${simBal.toLocaleString()} pts`;
          simViewerBal.style.color = "inherit";
          if (simShopItem) simShopItem.classList.remove("is-redeeming");
          simFeedbackNote.textContent = "Click button to test instant ledger balance update.";
          simFeedbackNote.style.color = "inherit";
          simRedeemBtn.disabled = false;
          simRedeemBtn.textContent = "Simulate Viewer Redemption";
        }, 4000);
      }
    });
  }

  // Interactive Telegram Bot Quick Commands
  const chatContainer = document.getElementById("simChatContainer");
  const cmdPills = document.querySelectorAll("[data-chat-cmd]");
  function getReply(cmd) {
    switch (cmd) {
      case "/points":
        return "Hey @pixelpilot! Your current balance is <strong>9,870 points</strong> (#02 on the leaderboard). Top player is @nightowl with 12,560 pts.";
      case "/rank":
        return "📊 You are ranked <strong>#02</strong> out of 342 active stream viewers!";
      case "/shop":
        return "👑 Shop Items Available: VIP Discord Role (800 pts) · Custom Chat Emote (1,200 pts) · Stream Shoutout (2,000 pts).";
      case "/rules":
        return "📜 Standings reset monthly. Every Kick sub = 500 pts. Redemptions close at midnight on Sunday!";
      default:
        return "Command executed.";
    }
  }

  cmdPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const cmd = pill.getAttribute("data-chat-cmd");
      if (!chatContainer || !cmd) return;

      // Add user message
      const userBubble = document.createElement("div");
      userBubble.className = "chat-bubble chat-bubble--user";
      const code = document.createElement("code");
      code.textContent = cmd;
      userBubble.appendChild(code);
      chatContainer.appendChild(userBubble);

      // Typing indicator
      const typingBubble = document.createElement("div");
      typingBubble.className = "chat-bubble chat-bubble--bot chat-bubble--typing";
      typingBubble.textContent = "YourRank Bot is typing...";
      chatContainer.appendChild(typingBubble);
      chatContainer.scrollTop = chatContainer.scrollHeight;

      setTimeout(() => {
        if (typingBubble.parentNode) typingBubble.parentNode.removeChild(typingBubble);
        const botBubble = document.createElement("div");
        botBubble.className = "chat-bubble chat-bubble--bot";
        const p = document.createElement("p");
        p.innerHTML = getReply(cmd);
        botBubble.appendChild(p);
        chatContainer.appendChild(botBubble);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 450);
    });
  });

})();
