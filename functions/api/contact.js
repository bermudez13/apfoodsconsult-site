export async function onRequestPost(context) {
  const { request, env } = context;

  // Only allow form POST from your site (basic Origin check)
  const origin = request.headers.get("Origin") || "";
  const allowed = ["https://apfoodconsulting.com", "https://apfoodsconsult-site.pages.dev"];
  if (origin && !allowed.includes(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const form = await request.formData();

  // Honeypot
  const hp = (form.get("company") || "").toString().trim();
  if (hp) {
    // pretend OK
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Required fields
  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  if (!name || !email || !message) {
    return new Response(JSON.stringify({ ok: false, error: "missing_fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Turnstile verify
  const token = (form.get("cf-turnstile-response") || "").toString();
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "turnstile_missing" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  });

  const verify = await verifyRes.json();
  if (!verify.success) {
    return new Response(JSON.stringify({ ok: false, error: "turnstile_failed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Optional fields
  const phone = (form.get("phone") || "").toString().trim();
  const language = (form.get("language") || "").toString().trim();
  const business = (form.get("business") || "").toString().trim();
  const locale = (form.get("locale") || "").toString().trim();

  // TODO: Send email using your chosen provider (MailChannels/Resend/SendGrid/etc.)
  // Use env vars for API keys and destination addresses.

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
