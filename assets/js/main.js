// File: /assets/js/main.js
// AP Food Consulting - main.js (EN/ES + hero + header + mobile nav + contact form)

(function () {
  "use strict";

  // Footer year
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();

/* Header offset: set CSS var to actual header height (fixes anchor scroll + hero padding) */
(function () {
  var header = document.querySelector(".site-header");
  if (!header) return;

  function setHeaderOffset() {
    var h = header.getBoundingClientRect().height || 0;
    var px = Math.max(64, Math.round(h + 8));
    document.documentElement.style.setProperty("--header-offset", px + "px");
  }

  window.addEventListener("resize", setHeaderOffset);
  setHeaderOffset();

  if (document.fonts && typeof document.fonts.ready === "object") {
    document.fonts.ready.then(function () {
      setHeaderOffset();
    });
  }
})();

/* Mobile nav toggle */
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primaryNav");
  var header = document.querySelector(".site-header");
  if (!toggle || !nav || !header) return;

  var firstLink = nav.querySelector("a");

  function setOpen(isOpen) {
    header.classList.toggle("nav-open", isOpen);
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");

    var h = header.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty(
      "--header-offset",
      Math.max(64, Math.round(h + 8)) + "px"
    );

    if (isOpen && firstLink) firstLink.focus();
    if (!isOpen) toggle.focus();
  }

  toggle.addEventListener("click", function () {
    setOpen(!header.classList.contains("nav-open"));
  });

  nav.addEventListener("click", function (e) {
    var t = e.target;

    if (
      t &&
      t.tagName === "A" &&
      header.classList.contains("nav-open")
    ) {
      setOpen(false);
    }
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("nav-open")) {
      setOpen(false);
    }
  });

  window.addEventListener("resize", function () {
    if (
      window.innerWidth > 980 &&
      header.classList.contains("nav-open")
    ) {
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
  var heroImgs = Array.prototype.slice.call(
    document.querySelectorAll(".hero-img")
  );

  if (!heroImgs.length) return;

  var mq = window.matchMedia("(max-width: 980px)");

  function applySources() {
    var isMobile = mq.matches;

    heroImgs.forEach(function (img) {
      var desktop = img.getAttribute("data-desktop");
      var mobile = img.getAttribute("data-mobile");

      var desired = isMobile
        ? mobile || desktop
        : desktop || img.getAttribute("src");

      if (!desired) return;

      if (img.getAttribute("src") !== desired) {
        img.setAttribute("src", desired);
      }
    });
  }

  if (mq.addEventListener) {
    mq.addEventListener("change", applySources);
  } else {
    mq.addListener(applySources);
  }

  applySources();
})();

/* Hero slideshow */
(function () {
  var hero = document.querySelector(".hero-full");
  var images = Array.prototype.slice.call(
    document.querySelectorAll(".hero-img")
  );

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
      if (i === 0) {
        img.classList.add("active");
      } else {
        img.classList.remove("active");
      }
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

        if (entry.isIntersecting) {
          start();
        } else {
          stop();
        }
      },
      { threshold: 0.12 }
    );

    io.observe(hero);
  } else {
    start();
  }
})();

/* Contact form */
(function () {
  var form = document.getElementById("contactForm");
  if (!form) return;

  var submitBtn = form.querySelector('button[type="submit"]');
  var statusEl = document.getElementById("formStatus");

  function getLocale() {
    var hidden = form.querySelector('input[name="locale"]');
    var v = hidden ? String(hidden.value || "").toLowerCase() : "";

    if (v === "es" || v === "en") return v;

    var lang = (document.documentElement.lang || "").toLowerCase();

    if (lang.startsWith("es")) return "es";
    if (lang.startsWith("en")) return "en";

    if (window.location.pathname.startsWith("/es/")) return "es";

    return "en";
  }

  var locale = getLocale();

  var t = {
    en: {
      sending: "Sending…",
      sent: "Message sent. We’ll reply within 1–2 business days.",
      network: "Network error. Please check your connection and try again.",
      timeout: "Request timed out. Please try again.",
      rateLimit: "Too many attempts. Please wait an hour and try again.",
      turnstile: "Please complete the security check and try again.",
      invalid:
        "Please check the required fields (name, email, county, and message).",
      invalidEmail: "Email doesn't look valid.",
      outsideArea:
        "We currently don't provide service in the selected area.",
      fallbackEmail:
        "Something went wrong. Please email info@apfoodconsulting.com.",
    },

    es: {
      sending: "Enviando…",
      sent: "Listo. Mensaje enviado. Te responderemos en 1–2 días laborables.",
      network: "Error de red. Revisa tu conexión e intenta de nuevo.",
      timeout: "La solicitud tardó demasiado. Intenta de nuevo.",
      rateLimit:
        "Demasiados intentos. Espera una hora e inténtalo de nuevo.",
      turnstile:
        "Completa la verificación de seguridad e inténtalo otra vez.",
      invalid:
        "Revisa los campos requeridos (nombre, email, condado y mensaje).",
      invalidEmail: "El email no parece válido.",
      outsideArea:
        "Actualmente no ofrecemos servicios en el área seleccionada.",
      fallbackEmail:
        "Ocurrió un error. Escríbenos a info@apfoodconsulting.com.",
    },
  }[locale];

  function setStatus(message, kind) {
    if (!statusEl) return;

    statusEl.textContent = message || "";
    statusEl.classList.remove("is-success", "is-error");

    if (kind === "success") {
      statusEl.classList.add("is-success");
    }

    if (kind === "error") {
      statusEl.classList.add("is-error");
    }
  }

  function setLoading(loading) {
    if (!submitBtn) return;

    submitBtn.disabled = !!loading;

    submitBtn.dataset.originalText =
      submitBtn.dataset.originalText || submitBtn.textContent;

    submitBtn.textContent = loading
      ? t.sending
      : submitBtn.dataset.originalText;
  }

  function isValidEmail(email) {
    var v = String(email || "").trim();

    if (!v) return false;
    if (v.length > 254) return false;

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function clampLen(v, max) {
    v = String(v || "");

    return v.length <= max
      ? v
      : v.slice(0, max);
  }

  function resetTurnstileIfPresent() {
    if (
      window.turnstile &&
      typeof window.turnstile.reset === "function"
    ) {
      try {
        window.turnstile.reset();
      } catch (_) {}
    }
  }

  function markInvalid(el, isBad) {
    if (!el) return;

    if (isBad) {
      el.setAttribute("aria-invalid", "true");
    } else {
      el.removeAttribute("aria-invalid");
    }
  }

  var inFlight = false;

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (inFlight) return;

    setStatus("", null);

    var nameEl = form.querySelector('input[name="name"]');
    var emailEl = form.querySelector('input[name="email"]');
    var countyEl = form.querySelector('select[name="county"]');
    var messageEl = form.querySelector('textarea[name="message"]');

    var name = nameEl
      ? String(nameEl.value || "").trim()
      : "";

    var email = emailEl
      ? String(emailEl.value || "").trim()
      : "";

    var county = countyEl
      ? String(countyEl.value || "").trim()
      : "";

    var message = messageEl
      ? String(messageEl.value || "").trim()
      : "";

    markInvalid(nameEl, false);
    markInvalid(emailEl, false);
    markInvalid(countyEl, false);
    markInvalid(messageEl, false);

    var missing = false;
    var firstInvalid = null;

    if (!name) {
      markInvalid(nameEl, true);
      missing = true;

      if (!firstInvalid) {
        firstInvalid = nameEl;
      }
    }

    if (!email) {
      markInvalid(emailEl, true);
      missing = true;

      if (!firstInvalid) {
        firstInvalid = emailEl;
      }
    }

    if (!county) {
      markInvalid(countyEl, true);
      missing = true;

      if (!firstInvalid) {
        firstInvalid = countyEl;
      }
    }

    if (!message) {
      markInvalid(messageEl, true);
      missing = true;

      if (!firstInvalid) {
        firstInvalid = messageEl;
      }
    }

    if (missing) {
      setStatus(t.invalid, "error");

      if (firstInvalid && typeof firstInvalid.focus === "function") {
        firstInvalid.focus();
      }

      return;
    }

    if (!isValidEmail(email)) {
      markInvalid(emailEl, true);
      setStatus(t.invalidEmail, "error");

      if (emailEl) {
        emailEl.focus();
      }

      return;
    }

    // Honeypot
    var hp = form.querySelector('input[name="company"]');

    if (hp && String(hp.value || "").trim()) {
      form.reset();
      setStatus(t.sent, "success");
      resetTurnstileIfPresent();
      return;
    }

    // Turnstile token (IMPORTANT: can be textarea, not input)
    var tsEl = form.querySelector(
      '[name="cf-turnstile-response"]'
    );

    var ts = tsEl ? tsEl.value : "";
    ts = String(ts || "").trim();

    if (!ts) {
      setStatus(t.turnstile, "error");
      return;
    }

    // Clamp lengths client-side
    if (nameEl) {
      nameEl.value = clampLen(nameEl.value, 80);
    }

    if (emailEl) {
      emailEl.value = clampLen(emailEl.value, 120);
    }

    if (messageEl) {
      messageEl.value = clampLen(messageEl.value, 1200);
    }

    inFlight = true;
    setLoading(true);

    var controller = new AbortController();

    var timeoutId = window.setTimeout(function () {
      try {
        controller.abort();
      } catch (_) {}
    }, 15000);

    (async function () {
      try {
        var formData = new FormData(form);

        var res = await fetch(
          form.getAttribute("action") || "/api/contact",
          {
            method: "POST",
            body: formData,
            headers: {
              Accept: "application/json",
            },
            signal: controller.signal,
          }
        );

        var raw = await res.text();
        var data = {};

        try {
          data = raw
            ? JSON.parse(raw)
            : {};
        } catch (_) {
          data = {};
        }

        if (res.ok && data && data.ok) {
          setStatus(t.sent, "success");
          form.reset();
          resetTurnstileIfPresent();
          return;
        }

        if (
          res.status === 429 ||
          data.code === "RATE_LIMIT"
        ) {
          setStatus(t.rateLimit, "error");
          return;
        }

        var isTurnstile =
          data.code === "TURNSTILE_REQUIRED" ||
          data.code === "TURNSTILE_FAILED" ||
          res.status === 403;

        if (isTurnstile) {
          resetTurnstileIfPresent();
          setStatus(t.turnstile, "error");
          return;
        }

        if (data.code === "MISSING_FIELDS") {
          setStatus(t.invalid, "error");
          return;
        }

        if (data.code === "INVALID_EMAIL") {
          markInvalid(emailEl, true);
          setStatus(t.invalidEmail, "error");

          if (emailEl) {
            emailEl.focus();
          }

          return;
        }

        if (data.code === "OUTSIDE_SERVICE_AREA") {
          markInvalid(countyEl, true);
          setStatus(t.outsideArea, "error");

          if (countyEl) {
            countyEl.focus();
          }

          return;
        }

        setStatus(
          data.error || t.fallbackEmail,
          "error"
        );

        resetTurnstileIfPresent();
      } catch (err) {
        if (err && err.name === "AbortError") {
          setStatus(t.timeout, "error");
        } else {
          setStatus(t.network, "error");
        }

        resetTurnstileIfPresent();
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
        inFlight = false;
      }
    })();
  });
})();