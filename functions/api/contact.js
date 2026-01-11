// File: /functions/api/contact.js
// AP Food Consulting - contact endpoint (Turnstile + honeypot + optional KV rate limit + MailChannels)
// Env vars expected (Cloudflare Pages -> Settings -> Environment variables):
// - TURNSTILE_SECRET (required)
// - CONTACT_TO (required)            
// - CONTACT_FROM (required)          e.g. "info@apfoodconsulting.com"
// - CONTACT_SUBJECT_PREFIX (optional) default "[AP Food Consulting]"
// Optional:
// - ALLOWED_ORIGINS (optional)       e.g. "https://apfoodconsulting.com,https://apfoodsconsult-site.pages.dev"
// KV (optional but recommended):
// - Bind a KV namespace as RATE_LIMIT_KV (5 per hour per IP)

export async function onRequestPost(context) {
  const { request, env } = context;
  const reqId = crypto.randomUUID();
  const log = (...args) => console.log(`[contact ${reqId}]`, ...args);

  try {
    // Basic origin allowlist (recommended). If not set, allow same-origin posts.
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      return json({ ok: false, error: "Forbidden origin.", reqId }, 403);
    }

    const TURNSTILE_SECRET = env.TURNSTILE_SECRET;
    const CONTACT_TO = env.CONTACT_TO;
    const CONTACT_FROM = env.CONTACT_FROM;
    const CONTACT_SUBJECT_PREFIX = env.CONTACT_SUBJECT_PREFIX || "[AP Food Consulting]";
    const RATE_LIMIT_KV = env.RATE_LIMIT_KV; // optional KV binding

    if (!TURNSTILE_SECRET || !CONTACT_TO || !CONTACT_FROM) {
      return json(
        { ok: false, error: "Server misconfiguration: missing env vars.", reqId },
        500
      );
    }

    // ---- Optional Rate limit (5 submissions per hour per IP) ----
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    if (RATE_LIMIT_KV && ip !== "unknown") {
      const WINDOW_SECONDS = 60 * 60;
      const MAX_REQUESTS = 5;
      const rlKey = `rl:v1:contact:${ip}`;

      const current = await RATE_LIMIT_KV.get(rlKey, "json").catch(() => null);
      const count = Number(current?.count || 0);

      if (count >= MAX_REQUESTS) {
        log("Rate limit exceeded", { ip, count });
        return json(
          { ok: false, error: "Too many requests.", code: "RATE_LIMIT", reqId },
          429
        );
      }

      await RATE_LIMIT_KV.put(
        rlKey,
        JSON.stringify({ count: count + 1, firstAt: current?.firstAt || Date.now() }),
        { expirationTtl: WINDOW_SECONDS }
      );
    }

    // ---- Parse body (form-data / urlencoded / json) ----
    const contentType = request.headers.get("content-type") || "";
    let body = {};

    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    } else {
      return json(
        { ok: false, error: "Unsupported content-type.", reqId, contentType },
        415
      );
    }

    // ---- Extract fields (trim + clamp) ----
    const locale = clamp((body.locale || "").toString().trim(), 10);

    const name = clamp((body.name || "").toString().trim(), 80);
    const email = clamp((body.email || "").toString().trim(), 120);
    const phone = clamp((body.phone || "").toString().trim(), 30);
    const language = clamp((body.language || "").toString().trim(), 30);
    const business = clamp((body.business || "").toString().trim(), 120);
    const message = clamp((body.message || "").toString().trim(), 1200);

    // Turnstile token
    const turnstileToken = clamp(
      (body["cf-turnstile-response"] || body.turnstileToken || "").toString().trim(),
      5000
    );

    // Honeypot: name="company" (must be empty)
    const honeypot = clamp((body.company || "").toString().trim(), 200);

    log("Incoming", {
      locale: locale || null,
      nameLen: name.length,
      emailLen: email.length,
      phoneLen: phone.length,
      language: language || null,
      businessLen: business.length,
      messageLen: message.length,
      hasTurnstile: !!turnstileToken,
      hp: honeypot ? "filled" : "empty",
      ip,
    });

    // Require minimal fields (message is required for this site)
    if (!name || !email || !message) {
      return json(
        { ok: false, error: "Missing required fields.", code: "MISSING_FIELDS", reqId },
        400
      );
    }

    if (!turnstileToken) {
      return json(
        { ok: false, error: "Turnstile required.", code: "TURNSTILE_REQUIRED", reqId },
        400
      );
    }

    if (!isValidEmail(email)) {
      return json(
        { ok: false, error: "Invalid email.", code: "INVALID_EMAIL", reqId },
        400
      );
    }

    // Honeypot: silently accept but do not send
    if (honeypot) {
      log("Honeypot triggered. Skipping send.");
      return json({ ok: true, reqId }, 200);
    }

    // ---- Turnstile verify ----
    const tsForm = new FormData();
    tsForm.append("secret", TURNSTILE_SECRET);
    tsForm.append("response", turnstileToken);
    if (ip && ip !== "unknown") tsForm.append("remoteip", ip);

    const tsResp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: tsForm }
    );

    const tsJson = await tsResp.json().catch(() => null);
    log("Turnstile", { status: tsResp.status, success: tsJson?.success });

    if (!tsResp.ok || !tsJson?.success) {
      return json(
        { ok: false, error: "Turnstile verification failed.", code: "TURNSTILE_FAILED", reqId },
        403
      );
    }

    // ---- MailChannels ----
    const toList = CONTACT_TO.split(",").map((s) => s.trim()).filter(Boolean);
    if (!toList.length) {
      return json(
        { ok: false, error: "Server misconfiguration: CONTACT_TO empty.", reqId },
        500
      );
    }

    const subject =
      locale.toLowerCase() === "es"
        ? `${CONTACT_SUBJECT_PREFIX} Nueva solicitud desde el sitio`
        : `${CONTACT_SUBJECT_PREFIX} New website inquiry`;

    const safePhone = phone || "(not provided)";
    const safeLanguage = language || "(not selected)";
    const safeBusiness = business || "(not provided)";

    const textBody = [
      "New Contact Form Submission",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${safePhone}`,
      `Preferred language: ${safeLanguage}`,
      `Restaurant / Business: ${safeBusiness}`,
      "",
      "Message:",
      message,
      "",
      `Locale: ${locale || "(not provided)"}`,
      `IP: ${ip}`,
      `Request ID: ${reqId}`,
    ].join("\n");

    const htmlBody = `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(safePhone)}</p>
      <p><strong>Preferred language:</strong> ${escapeHtml(safeLanguage)}</p>
      <p><strong>Restaurant / Business:</strong> ${escapeHtml(safeBusiness)}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(message)}</pre>
      <hr />
      <p><small>Locale: ${escapeHtml(locale || "(not provided)")}</small></p>
      <p><small>IP: ${escapeHtml(ip)}</small></p>
      <p><small>Request ID: ${escapeHtml(reqId)}</small></p>
    `;

    const payload = {
      personalizations: [
        {
          to: toList.map((addr) => ({ email: addr })),
          reply_to: { email: email, name: name || undefined },
        },
      ],
      from: { email: CONTACT_FROM, name: "AP Food Consulting" },
      subject,
      content: [
        { type: "text/plain", value: textBody },
        { type: "text/html", value: htmlBody },
      ],
    };

    const mcResp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const mcText = await mcResp.text();
    let mcJson = null;
    try { mcJson = mcText ? JSON.parse(mcText) : null; } catch (_) {}

    log("MailChannels response", { status: mcResp.status, ok: mcResp.ok });

    if (!mcResp.ok) {
      return json(
        { ok: false, error: "Email provider error.", reqId, status: mcResp.status },
        502
      );
    }

    return json({ ok: true, reqId }, 200);
  } catch (err) {
    console.error(`[contact] fatal`, err);
    return json({ ok: false, error: "Unhandled server error.", reqId: "unknown" }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, maxLen) {
  const s = String(value || "");
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isValidEmail(email) {
  const v = String(email || "").trim();
  if (!v) return false;
  if (v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
