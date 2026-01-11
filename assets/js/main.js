// File: /assets/js/main.js

(function () {
  // Footer year
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();

/* Mobile nav toggle */
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primaryNav");
  var header = document.querySelector(".site-header");

  if (!toggle || !nav || !header) return;

  function setOpen(isOpen) {
    header.classList.toggle("nav-open", isOpen);
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    if (isOpen) {
      // Move focus to first nav link for keyboard users
      var firstLink = nav.querySelector("a");
      if (firstLink) firstLink.focus();
    } else {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", function () {
    var isOpen = header.classList.contains("nav-open");
    setOpen(!isOpen);
  });

  // Close when clicking a link
  nav.addEventListener("click", function (e) {
    var target = e.target;
    if (target && target.tagName === "A" && header.classList.contains("nav-open")) {
      setOpen(false);
    }
  });

  // Close on Escape
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("nav-open")) {
      setOpen(false);
    }
  });

  // Close on resize back to desktop
  window.addEventListener("resize", function () {
    if (window.innerWidth > 980 && header.classList.contains("nav-open")) {
      setOpen(false);
    }
  });
})();

/* Header: transparent over hero, solid after scroll */
(function () {
  var header = document.querySelector(".site-header");
  var hero = document.querySelector(".hero-full");
  if (!header || !hero) return;

  function apply() {
    var heroRect = hero.getBoundingClientRect();
    var heroBottomFromTop = heroRect.bottom;
    var threshold = 120;

    if (heroBottomFromTop > threshold) {
      header.classList.add("is-overlay");
      header.classList.remove("is-solid");
    } else {
      header.classList.remove("is-overlay");
      header.classList.add("is-solid");
    }
  }

  window.addEventListener("scroll", apply, { passive: true });
  window.addEventListener("resize", apply);
  apply();
})();

/* Hero: swap desktop/mobile sources */
(function () {
  var heroImgs = Array.prototype.slice.call(document.querySelectorAll(".hero-img"));
  if (!heroImgs.length) return;

  var mq = window.matchMedia("(max-width: 980px)");

  function applySources() {
    var isMobile = mq.matches;

    heroImgs.forEach(function (img) {
      var desktop = img.getAttribute("data-desktop");
      var mobile = img.getAttribute("data-mobile");

      var desired = isMobile ? (mobile || desktop) : (desktop || img.getAttribute("src"));
      if (!desired) return;

      if (img.getAttribute("src") !== desired) {
        img.setAttribute("src", desired);
      }
    });
  }

  if (mq.addEventListener) mq.addEventListener("change", applySources);
  else mq.addListener(applySources);

  applySources();
})();

/* Hero background slideshow (fade) + pause when out of view */
(function () {
  var hero = document.querySelector(".hero-full");
  var images = Array.prototype.slice.call(document.querySelectorAll(".hero-img"));
  if (!hero || images.length <= 1) return;

  var prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  var index = 0;
  var intervalMs = 7000;
  var timerId = null;

  function preload(src) {
    if (!src) return;
    var img = new Image();
    img.decoding = "async";
    img.src = src;
  }

  function getSrc(el) {
    return el.getAttribute("src");
  }

  function ensureInitialState() {
    images.forEach(function (img, i) {
      if (i === 0) img.classList.add("active");
      else img.classList.remove("active");
    });
    index = 0;

    preload(getSrc(images[1]));
  }

  function tick() {
    var current = images[index];
    var nextIndex = (index + 1) % images.length;
    var next = images[nextIndex];

    var afterNextIndex = (nextIndex + 1) % images.length;
    preload(getSrc(images[afterNextIndex]));

    current.classList.remove("active");
    next.classList.add("active");
    index = nextIndex;
  }

  function start() {
    if (timerId) return;
    timerId = window.setInterval(tick, intervalMs);
  }

  function stop() {
    if (!timerId) return;
    window.clearInterval(timerId);
    timerId = null;
  }

  ensureInitialState();

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        var entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) start();
        else stop();
      },
      { threshold: 0.12 }
    );

    io.observe(hero);
  } else {
    start();
  }
})();

// Contact form async submit (Turnstile + honeypot + hardened)
(function () {
  var form = document.getElementById("contactForm");
  var statusEl = document.getElementById("formStatus");
  if (!form) return;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "rgba(255, 130, 130, 0.9)" : "";
  }

  function setBusy(isBusy) {
    form.setAttribute("aria-busy", isBusy ? "true" : "false");
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = !!isBusy;
  }

  function resetTurnstile() {
    // Turnstile exposes window.turnstile when loaded
    if (window.turnstile && typeof window.turnstile.reset === "function") {
      try {
        window.turnstile.reset();
      } catch (_) {}
    }
  }

  var inflight = false;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (inflight) return;

    // Basic required checks (since novalidate is set)
    var name = form.querySelector("#name");
    var email = form.querySelector("#email");
    var message = form.querySelector("#message");

    if (!name || !name.value.trim()) {
      setStatus("Please enter your name.", true);
      name && name.focus();
      return;
    }
    if (!email || !email.value.trim()) {
      setStatus("Please enter your email.", true);
      email && email.focus();
      return;
    }
    if (!message || !message.value.trim()) {
      setStatus("Please enter a brief message.", true);
      message && message.focus();
      return;
    }

    // Honeypot: if filled, pretend success (don’t confirm spam)
    var hp = form.querySelector('input[name="company"]');
    if (hp && hp.value && hp.value.trim().length > 0) {
      form.reset();
      setStatus("Message sent. We’ll reply within 1–2 business days.", false);
      resetTurnstile();
      return;
    }

    // Turnstile token is posted as "cf-turnstile-response"
    var tokenEl = form.querySelector('input[name="cf-turnstile-response"]');
    var token = tokenEl ? tokenEl.value : "";
    if (!token) {
      setStatus("Please complete the security check and try again.", true);
      return;
    }

    inflight = true;
    setBusy(true);
    setStatus("Sending…", false);

    try {
      var formData = new FormData(form);

      var res = await fetch(form.getAttribute("action") || "/api/contact", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        resetTurnstile();
        setStatus("Something went wrong. Please email info@apfoodconsulting.com.", true);
        return;
      }

      setStatus("Message sent. We’ll reply within 1–2 business days.", false);
      form.reset();
      resetTurnstile();
    } catch (err) {
      resetTurnstile();
      setStatus("Network error. Please email info@apfoodconsulting.com.", true);
    } finally {
      inflight = false;
      setBusy(false);
    }
  });
})();

