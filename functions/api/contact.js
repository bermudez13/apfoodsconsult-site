// File: /functions/api/contact.js
// AP Food Consulting - contact endpoint (Turnstile + honeypot + optional KV rate limit + Resend)
//
// Env vars expected (Cloudflare Pages -> Settings -> Environment variables):
// - TURNSTILE_SECRET (required)
// - RESEND_API_KEY (required)
// - CONTACT_TO (required)            comma-separated list allowed (recommend: your personal Gmail)
// - CONTACT_FROM (required)          e.g. "AP Food Consulting <info@apfoodconsulting.com>"
// - CONTACT_SUBJECT_PREFIX (optional) default "[AP Food Consulting]"
// - ALLOWED_ORIGINS (optional)       e.g. "https://apfoodconsulting.com,https://apfoodsconsult-site.pages.dev"
//
// KV (optional but recommended):
// - Bind a KV namespace as RATE_LIMIT_KV (5 per hour per IP)
//
// Notes:
// - Returns JSON only.
// - Avoids leaking operational details in responses; logs keep reqId correlation.

export async function onRequestPost(context) {
  const { request, env } = context;
  const reqId = crypto.randomUUID();
  const log = (...args) => console.log(`[contact ${reqId}]`, ...args);

  try {
    // ----------------------------
    // CORS / Origin allowlist
    // ----------------------------
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // If allowlist exists and request has an Origin, enforce it.
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      return json(
        { ok: false, error: "Forbidden.", code: "FORBIDDEN_ORIGIN", reqId },
        403,
        originForCors(origin, allowedOrigins)
      );
    }

    const TURNSTILE_SECRET = env.TURNSTILE_SECRET;
    const RESEND_API_KEY = env.RESEND_API_KEY;
    const CONTACT_TO = env.CONTACT_TO;
    const CONTACT_FROM = env.CONTACT_FROM;
    const CONTACT_SUBJECT_PREFIX =
      env.CONTACT_SUBJECT_PREFIX || "[AP Food Consulting]";
    const RATE_LIMIT_KV = env.RATE_LIMIT_KV; // optional KV binding

    if (!TURNSTILE_SECRET || !RESEND_API_KEY || !CONTACT_TO || !CONTACT_FROM) {
      // Do not reveal which env var is missing.
      return json(
        { ok: false, error: "Server misconfiguration.", code: "MISCONFIG", reqId },
        500,
        originForCors(origin, allowedOrigins)
      );
    }

    // ----------------------------
    // IP (for rate limiting + Turnstile remoteip)
    // ----------------------------
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    // Hash IP so KV keys are not raw IPs at rest
    const ipKey = ip !== "unknown" ? await sha256Hex(ip) : "unknown";

    // ----------------------------
    // Optional Rate limit (5 submissions per hour per IP)
    // ----------------------------
    if (RATE_LIMIT_KV && ipKey !== "unknown") {
      const WINDOW_SECONDS = 60 * 60;
      const MAX_REQUESTS = 5;
      const rlKey = `rl:v2:contact:${ipKey}`;

      const current = await RATE_LIMIT_KV.get(rlKey, "json").catch(() => null);
      const count = Number(current?.count || 0);

      if (count >= MAX_REQUESTS) {
        log("Rate limit exceeded", { ip: "[redacted]", count });
        return json(
          { ok: false, error: "Too many requests.", code: "RATE_LIMIT", reqId },
          429,
          originForCors(origin, allowedOrigins)
        );
      }

      await RATE_LIMIT_KV.put(
        rlKey,
        JSON.stringify({
          count: count + 1,
          firstAt: current?.firstAt || Date.now(),
        }),
        { expirationTtl: WINDOW_SECONDS }
      );
    }

    // ----------------------------
    // Parse body (form-data / urlencoded / json)
    // ----------------------------
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
        { ok: false, error: "Unsupported content-type.", code: "UNSUPPORTED_TYPE", reqId },
        415,
        originForCors(origin, allowedOrigins)
      );
    }

    // ----------------------------
    // Extract fields (trim + clamp + sanitize)
    // ----------------------------
    const locale = clamp(cleanText(body.locale), 10);

    const name = clamp(cleanText(body.name), 80);
    const email = clamp(cleanText(body.email), 120);
    const phone = clamp(cleanText(body.phone), 30);
    const language = clamp(cleanText(body.language), 30);
    const business = clamp(cleanText(body.business), 120);
    const message = clamp(cleanText(body.message), 1200);

    // Turnstile token
    const turnstileToken = clamp(
      cleanText(body["cf-turnstile-response"] || body.turnstileToken),
      5000
    );

    // Honeypot: name="company" (must be empty)
    const honeypot = clamp(cleanText(body.company), 200);

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
      ip: ip === "unknown" ? "unknown" : "[redacted]",
    });

    // Require minimal fields
    if (!name || !email || !message) {
      return json(
        { ok: false, error: "Missing required fields.", code: "MISSING_FIELDS", reqId },
        400,
        originForCors(origin, allowedOrigins)
      );
    }

    if (!turnstileToken) {
      return json(
        { ok: false, error: "Security check required.", code: "TURNSTILE_REQUIRED", reqId },
        400,
        originForCors(origin, allowedOrigins)
      );
    }

    if (!isValidEmail(email)) {
      return json(
        { ok: false, error: "Invalid email.", code: "INVALID_EMAIL", reqId },
        400,
        originForCors(origin, allowedOrigins)
      );
    }

    // Honeypot: silently accept but do not send
    if (honeypot) {
      log("Honeypot triggered. Skipping send.");
      return json({ ok: true, reqId }, 200, originForCors(origin, allowedOrigins));
    }

    // ----------------------------
    // Turnstile verify
    // ----------------------------
    const tsForm = new FormData();
    tsForm.append("secret", TURNSTILE_SECRET);
    tsForm.append("response", turnstileToken);
    if (ip && ip !== "unknown") tsForm.append("remoteip", ip);

    const tsResp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: tsForm }
    );

    const tsJson = await tsResp.json().catch(() => null);
    log("Turnstile", {
      status: tsResp.status,
      success: !!tsJson?.success,
      code: tsJson?.["error-codes"]?.[0] || null,
    });

    if (!tsResp.ok || !tsJson?.success) {
      return json(
        { ok: false, error: "Security verification failed.", code: "TURNSTILE_FAILED", reqId },
        403,
        originForCors(origin, allowedOrigins)
      );
    }

    // ----------------------------
    // Resend send
    // ----------------------------
    const toList = CONTACT_TO.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!toList.length) {
      return json(
        { ok: false, error: "Server misconfiguration.", code: "MISCONFIG", reqId },
        500,
        originForCors(origin, allowedOrigins)
      );
    }

    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");

    const subject =
      locale.toLowerCase() === "es"
         ? `${CONTACT_SUBJECT_PREFIX} Nueva solicitud (${timestamp})`
    : `${CONTACT_SUBJECT_PREFIX} New website inquiry (${timestamp})`;

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
      `IP: ${ip === "unknown" ? "unknown" : "[redacted]"}`,
      `Request ID: ${reqId}`,
    ].join("\n");

    // Keep HTML simple; avoid inline CSS beyond <pre> formatting
    const htmlBody = [
      `<h2>New Contact Form Submission</h2>`,
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
      `<p><strong>Phone:</strong> ${escapeHtml(safePhone)}</p>`,
      `<p><strong>Preferred language:</strong> ${escapeHtml(safeLanguage)}</p>`,
      `<p><strong>Restaurant / Business:</strong> ${escapeHtml(safeBusiness)}</p>`,
      `<p><strong>Message:</strong></p>`,
      `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(message)}</pre>`,
      `<hr />`,
      `<p><small>Locale: ${escapeHtml(locale || "(not provided)")}</small></p>`,
      `<p><small>Request ID: ${escapeHtml(reqId)}</small></p>`,
    ].join("");

    // Resend API: POST https://api.resend.com/emails
    // Docs show "replyTo" (SDK) and supports "from/to/subject/html/text".
    const resendPayload = {
      from: CONTACT_FROM, // e.g. "AP Food Consulting <info@apfoodconsulting.com>"
      to: toList, // array supported
      subject,
      text: textBody,
      html: htmlBody,
      reply_to: `${name} <${email}>`, // keep simple; avoids format edge cases
    };

    const rsResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reqId,
      },
      body: JSON.stringify(resendPayload),
    });

    const rsText = await rsResp.text();
    let rsJson = null;
    try {
      rsJson = rsText ? JSON.parse(rsText) : null;
    } catch (_) {
      rsJson = null;
    }

    log("Resend response", { status: rsResp.status, ok: rsResp.ok });

    if (!rsResp.ok) {
      log("Resend error body", {
        status: rsResp.status,
        body: rsJson || rsText || null,
      });

      return json(
        { ok: false, error: "Email provider error.", code: "EMAIL_PROVIDER", reqId },
        502,
        originForCors(origin, allowedOrigins)
      );
    }

    // Optionally log returned id for traceability
    if (rsJson?.id) log("Resend accepted", { id: rsJson.id });

    return json({ ok: true, reqId }, 200, originForCors(origin, allowedOrigins));
  } catch (err) {
    console.error(`[contact] fatal`, err);
    return json(
      { ok: false, error: "Unhandled server error.", code: "FATAL", reqId: "unknown" },
      500
    );
  }
}

function json(data, status = 200, cors = null) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  // Add minimal CORS headers when request comes from a browser Origin.
  if (cors && cors.allowOrigin) {
    headers["Access-Control-Allow-Origin"] = cors.allowOrigin;
    headers["Vary"] = "Origin";
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function originForCors(origin, allowedOrigins) {
  if (!origin) return null;

  // If allowlist is empty, same-origin posts are typical; reflecting origin is fine
  // because there is no cross-site JS access unless the browser sent Origin.
  if (!allowedOrigins || !allowedOrigins.length) {
    return { allowOrigin: origin };
  }

  if (allowedOrigins.includes(origin)) return { allowOrigin: origin };
  return null;
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

function cleanText(v) {
  // Normalize to string, trim, drop null bytes.
  const s = String(v == null ? "" : v);
  return s.replace(/\0/g, "").trim();
}

function isValidEmail(email) {
  const v = String(email || "").trim();
  if (!v) return false;
  if (v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, "0");
    hex += h;
  }
  return hex;
}
