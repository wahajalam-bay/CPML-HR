import "server-only";

/**
 * Transactional email.
 *
 * Provider-agnostic by design: it speaks Resend's HTTP API when a key is
 * present, and otherwise logs the message to the server console. The fallback
 * is what makes the platform usable before mail is provisioned — a preview
 * deploy can still complete a full sign-up flow by reading the link out of the
 * logs, rather than dead-ending at "check your email".
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  );
}

export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? "CPML HR <onboarding@resend.dev>";

  if (!apiKey) {
    // Deliberately loud and complete: without a provider this IS the delivery
    // mechanism, and a truncated link would make it useless.
    console.warn(
      [
        "",
        "─".repeat(72),
        "  EMAIL NOT SENT — RESEND_API_KEY is not configured.",
        "  The message below would have been delivered:",
        "",
        `  To:      ${mail.to}`,
        `  Subject: ${mail.subject}`,
        "",
        mail.text.split("\n").map((l) => `  ${l}`).join("\n"),
        "─".repeat(72),
        "",
      ].join("\n"),
    );
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!response.ok) {
      console.error("Email delivery failed:", response.status, await response.text());
    }
  } catch (error) {
    // A mail outage must not fail the sign-up that triggered it: the account
    // exists, and the user can request a fresh link.
    console.error("Email delivery threw:", error);
  }
}

/* -------------------------------------------------------------------------
 * Templates
 * ---------------------------------------------------------------------- */

function layout(heading: string, body: string, cta: { href: string; label: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f8f5;font-family:'Segoe UI',system-ui,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #c4d8ca;border-radius:16px;overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#063d24,#0a5c3d 45%,#0d7a3f);padding:20px 24px">
          <div style="color:#fff;font-size:17px;font-weight:800">CPML HR</div>
          <div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:.6px;text-transform:uppercase;font-weight:600">Bayut Saudi Arabia</div>
        </td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:18px;color:#1a2e22">${heading}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#506b5a">${body}</p>
          <a href="${cta.href}" style="display:inline-block;background:#0d7a3f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-size:14px;font-weight:600">${cta.label}</a>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#7d9488">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#0d7a3f">${cta.href}</span></p>
        </td></tr>
        <tr><td style="border-top:1px solid #c4d8ca;padding:14px 24px;font-size:11px;color:#7d9488">
          If you did not request this, you can ignore this email — no changes have been made.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verificationEmail(to: string, name: string, token: string): Mail {
  const href = `${baseUrl()}/verify?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Verify your email — CPML HR",
    text: `Hello ${name},\n\nConfirm your email address to activate your CPML HR account:\n\n${href}\n\nThis link expires in 24 hours.\n\nIf you did not sign up, ignore this email.`,
    html: layout(
      `Welcome, ${name}`,
      "Confirm your email address to activate your account. This link expires in 24 hours.",
      { href, label: "Verify email address" },
    ),
  };
}

export function passwordResetEmail(to: string, name: string, token: string): Mail {
  const href = `${baseUrl()}/reset?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password — CPML HR",
    text: `Hello ${name},\n\nA password reset was requested for your account:\n\n${href}\n\nThis link expires in one hour and can be used once. Resetting your password signs you out of all other devices.\n\nIf you did not request this, ignore this email — your password has not changed.`,
    html: layout(
      "Reset your password",
      "This link expires in one hour and can be used once. Resetting your password will sign you out of all other devices.",
      { href, label: "Choose a new password" },
    ),
  };
}

export function invitationEmail(
  to: string,
  inviterName: string,
  role: string,
  token: string,
): Mail {
  const href = `${baseUrl()}/signup?invite=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "You have been invited to CPML HR",
    text: `${inviterName} has invited you to CPML HR as ${role}.\n\nAccept the invitation and set a password:\n\n${href}\n\nThis invitation expires in 7 days.`,
    html: layout(
      "You have been invited",
      `${inviterName} has invited you to CPML HR as <strong>${role}</strong>. This invitation expires in 7 days.`,
      { href, label: "Accept invitation" },
    ),
  };
}

export { baseUrl };
