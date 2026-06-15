/**
 * VendHub — Firebase Cloud Functions (unified)
 * ══════════════════════════════════════════════════════════
 *
 * Functions:
 *   1. onAdminMessage         — Firestore trigger: when admin sends a chat
 *                               message → sends BOTH push notification AND
 *                               email to the vendor (single trigger, no dupe)
 *   2. sendApprovalEmail      — HTTPS callable: admin sends approval/rejection
 *   3. weeklyAdminSummary     — Scheduled: every Monday 8am ET to admin
 *   4. getVendorStats         — HTTPS callable: returns stats (admin only)
 *
 * ONE-TIME SETUP (run these commands before deploying):
 * ─────────────────────────────────────────────────────
 *   # 1. Generate VAPID keys
 *   npx web-push generate-vapid-keys
 *
 *   # 2. Save secrets (Firebase will prompt you to paste the value)
 *   firebase functions:secrets:set VAPID_PRIVATE_KEY
 *   firebase functions:secrets:set VAPID_SUBJECT      # e.g. mailto:you@example.com
 *
 *   # 3. Set email config (Gmail App Password — NOT your normal password)
 *   firebase functions:config:set email.user="your-gmail@gmail.com"
 *   firebase functions:config:set email.pass="your-16-char-app-password"
 *   firebase functions:config:set email.admin="admin@grandbazaar.com"
 *
 *   # 4. Copy the PUBLIC key into index.html (VAPID_PUBLIC_KEY constant)
 *
 *   # 5. Deploy
 *   cd functions && npm install && cd ..
 *   firebase deploy --only functions
 */

'use strict';

// ── SDK imports ───────────────────────────────────────────────────────────────
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret }      = require('firebase-functions/params');
const functions             = require('firebase-functions');   // v1 for callable/scheduled
const admin                 = require('firebase-admin');
const nodemailer            = require('nodemailer');
const webpush               = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// ── Secrets (stored via: firebase functions:secrets:set NAME) ─────────────────
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT     = defineSecret('VAPID_SUBJECT');    // e.g. "mailto:you@example.com"

// ── YOUR VAPID PUBLIC KEY ──────────────────────────────────────────────────────
// Copy the Public Key output from:  npx web-push generate-vapid-keys
// Then paste it here AND in index.html (the VAPID_PUBLIC_KEY constant)
const VAPID_PUBLIC_KEY =
  'BC2gm2NXUjPQMwz0j333xnUypD0-TqELZwQiJ87r1_2YLLZLp4SsTEza6UQ39n89mfPEfv79HcZzz3d6xHGjTK4';
//  ↑↑↑  REPLACE with your own key — this is a placeholder  ↑↑↑

// ── Email transporter factory ─────────────────────────────────────────────────
function makeTransporter() {
  const cfg = functions.config();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: cfg.email?.user || 'vendhub.businessjoin@gmail.com',
      pass: cfg.email?.pass || '',   // Gmail App Password (16 chars)
    },
  });
}

// ── Branded HTML email builder ────────────────────────────────────────────────
function buildEmail({ heading, subheading, bodyHtml, ctaText, ctaUrl, accentColor = '#c9a84c' }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:32px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:16px;overflow:hidden;max-width:580px;width:100%;
         box-shadow:0 8px 32px rgba(0,0,0,0.10);">

  <!-- Header -->
  <tr><td style="background:#0a0a0a;padding:0;">
    <div style="height:3px;background:linear-gradient(90deg,#a07830,#c9a84c,#e8d5a3);"></div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:22px 32px;">
        <span style="font-size:22px;font-weight:900;color:#fff;font-family:Georgia,serif;">
          Vend<span style="color:#c9a84c;">Hub</span>
        </span>
      </td>
      <td align="right" style="padding:22px 32px;">
        <span style="background:rgba(201,168,76,0.18);border:1px solid rgba(201,168,76,0.35);
          color:#e8d5a3;font-size:10px;font-weight:700;letter-spacing:1px;
          text-transform:uppercase;padding:3px 10px;border-radius:8px;">
          Vendor Portal
        </span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Accent banner -->
  <tr><td style="background:${accentColor};padding:22px 32px;">
    <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.75);
      font-weight:700;text-transform:uppercase;letter-spacing:1px;">
      ${subheading || 'VendHub Notification'}
    </p>
    <h1 style="margin:0;font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif;">
      ${heading}
    </h1>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">
    ${bodyHtml}
    ${ctaText && ctaUrl ? `
    <div style="text-align:center;margin-top:28px;">
      <a href="${ctaUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;
        text-decoration:none;padding:13px 30px;border-radius:10px;
        font-weight:700;font-size:14px;">${ctaText}</a>
    </div>` : ''}
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f7f5f0;padding:18px 32px;border-top:1px solid #e5e5e5;">
    <p style="margin:0;font-size:11px;color:#8a8a8e;text-align:center;">
      © ${new Date().getFullYear()} VendHub · The Vendor Marketplace<br>
      This is an automated message — please do not reply directly.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  1.  onAdminMessage  —  single Firestore trigger that sends BOTH:
//        • Web Push notification (appears on phone even when app is closed)
//        • Email notification (backup for devices without push)
// ─────────────────────────────────────────────────────────────────────────────
exports.onAdminMessage = onDocumentCreated(
  {
    document: 'vendors/{vendorId}/conversation/{msgId}',
    secrets:  [VAPID_PRIVATE_KEY, VAPID_SUBJECT],
    region:   'us-central1',
  },
  async (event) => {
    const msg      = event.data.data();
    const vendorId = event.params.vendorId;

    // Only react to messages sent by admin
    if ((msg.sender || '').toLowerCase() !== 'admin') return null;

    // ── Fetch vendor record ──────────────────────────────────────────────────
    const vendorSnap = await db.collection('vendors').doc(vendorId).get();
    if (!vendorSnap.exists) return null;

    const v         = vendorSnap.data();
    const userId    = v.user_id;
    const eventName = v.event_name || 'VendHub';
    const toEmail   = v.invoice_email || v.auth_email;
    const vendorName = v.business || v.full_name || 'Vendor';

    // ── Build message preview ────────────────────────────────────────────────
    const preview = msg.messageType === 'image'
      ? '📷 Sent you an image'
      : msg.messageType === 'document'
        ? `📎 Sent a file: ${msg.fileName || 'document'}`
        : (msg.message || '').slice(0, 120);

    // ── Count unread messages for badge number ───────────────────────────────
    const unreadSnap = await db
      .collection('vendors').doc(vendorId).collection('conversation')
      .where('sender',         '==', 'admin')
      .where('read_by_vendor', '==', false)
      .get();
    const unreadCount = unreadSnap.size;

    const chatUrl = `https://vendors-de792.web.app/index.html?event_chat=${vendorId}`;

    // ════════════════════════════════════════════════════════════
    //  A) WEB PUSH  (shows on phone home screen / lock screen)
    // ════════════════════════════════════════════════════════════
    if (userId) {
      const subsSnap = await db
        .collection('push_subscriptions')
        .where('user_id', '==', userId)
        .get();

      if (!subsSnap.empty) {
        webpush.setVapidDetails(
          VAPID_SUBJECT.value(),
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY.value()
        );

        const pushPayload = JSON.stringify({
          title: `💬 ${eventName}`,
          body:  preview,
          url:   chatUrl,
          icon:  '/images/icon-192.png',
          badge: '/images/icon-192.png',
          tag:   `vendhub-chat-${vendorId}`,
          count: unreadCount,
        });

        const pushSends = subsSnap.docs.map(async (subDoc) => {
          try {
            await webpush.sendNotification(subDoc.data().subscription, pushPayload, {
              urgency: 'high',
              TTL:     86400,  // 24 hours
            });
            console.log(`[Push] Sent to user ${userId} (sub ${subDoc.id})`);
          } catch (err) {
            console.error(`[Push] Failed sub ${subDoc.id}:`, err.statusCode, err.body);
            // Remove expired / invalid subscriptions automatically
            if (err.statusCode === 410 || err.statusCode === 404) {
              await subDoc.ref.delete();
              console.log(`[Push] Deleted stale subscription ${subDoc.id}`);
            }
          }
        });

        await Promise.allSettled(pushSends);
      } else {
        console.log(`[Push] No subscriptions for user ${userId}`);
      }
    }

    // ════════════════════════════════════════════════════════════
    //  B) EMAIL  (backup delivery — shows even without push)
    // ════════════════════════════════════════════════════════════
    if (toEmail) {
      const html = buildEmail({
        heading:    'New message from your coordinator',
        subheading: `Re: ${eventName}`,
        bodyHtml: `
          <p style="font-size:15px;color:#1c1c1e;margin:0 0 20px;">
            Hi <strong>${vendorName}</strong>,<br>
            Your event coordinator sent you a message about
            <strong>${eventName}</strong>:
          </p>
          <div style="background:#0a0a0a;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
            <p style="margin:0;font-size:14px;color:#fff;line-height:1.6;">${preview}</p>
          </div>
          ${unreadCount > 1 ? `
          <p style="font-size:13px;color:#f59e0b;font-weight:600;margin:0 0 16px;">
            ⚠️ You have ${unreadCount} unread messages in this chat.
          </p>` : ''}
          <p style="font-size:13px;color:#8a8a8e;margin:0;">
            Reply through the VendHub chat to keep your conversation in one place.
          </p>
        `,
        ctaText:     'Open Chat',
        ctaUrl:      chatUrl,
        accentColor: '#0a0a0a',
      });

      try {
        await makeTransporter().sendMail({
          from:    `"VendHub" <${functions.config().email?.user || 'vendhub.businessjoin@gmail.com'}>`,
          to:      toEmail,
          subject: `💬 New message — ${eventName} | VendHub`,
          html,
        });
        console.log(`[Email] Chat notification sent to ${toEmail}`);
      } catch (err) {
        // Don't fail the whole function if email fails
        console.error('[Email] Chat notification failed:', err.message);
      }
    }

    // ── Update unread_count on vendor doc (for badge display) ────────────────
    try {
      await db.collection('vendors').doc(vendorId).update({
        unread_count:             unreadCount,
        last_admin_message_at:    admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) { /* non-critical */ }

    return null;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
//  2.  sendApprovalEmail  —  HTTPS callable by admin UI
//      Sends a branded approval or rejection email to the vendor
// ─────────────────────────────────────────────────────────────────────────────
exports.sendApprovalEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.email !== 'admin@grandbazaar.com') {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }

  const { vendorDoc } = data;
  if (!vendorDoc) throw new functions.https.HttpsError('invalid-argument', 'vendorDoc required.');

  const snap = await db.collection('vendors').doc(vendorDoc).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Vendor not found.');

  const v          = snap.data();
  const toEmail    = v.invoice_email || v.auth_email;
  if (!toEmail) throw new functions.https.HttpsError('failed-precondition', 'No email on vendor doc.');

  const isApproved = (v.status || '').toLowerCase() === 'approved';
  const days       = Array.isArray(v.event_date) ? v.event_date.filter(Boolean).length : 1;
  const total      = `$${(v.price || 0) * (days || 1)}`;
  const adminMsg   = v.admin_message || '';

  const tableRow = (label, value, gold) =>
    `<tr style="background:${gold ? '#fffbee' : '#fff'};">
      <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#8a8a8e;
        text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #f0f0f0;
        white-space:nowrap;">${label}</td>
      <td style="padding:10px 14px;font-size:14px;font-weight:${gold ? '900' : '500'};
        color:${gold ? '#a07830' : '#1c1c1e'};border-bottom:1px solid #f0f0f0;">
        ${value}</td>
    </tr>`;

  const bodyHtml = `
    <p style="font-size:15px;color:#1c1c1e;margin:0 0 20px;">
      Hi <strong>${v.full_name || 'Vendor'}</strong>,<br>
      ${isApproved
        ? `🎉 Great news! Your application for <strong>${v.event_name}</strong> has been <strong style="color:#16a34a;">approved</strong>.`
        : `Thank you for your interest in <strong>${v.event_name}</strong>. Unfortunately, your application was not selected at this time.`}
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;margin-bottom:20px;">
      ${tableRow('Event',    v.event_name     || '—')}
      ${tableRow('Venue',    v.event_location || '—')}
      ${tableRow('Dates',    (v.event_date || []).join('  ·  ') || '—')}
      ${tableRow('Booth',    v.booth_label || v.booth_size || '—')}
      ${tableRow('Total Due', total, true)}
    </table>

    ${adminMsg ? `
    <div style="background:#f7f5f0;border-left:3px solid #c9a84c;
      padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;
        color:#8a8a8e;letter-spacing:.7px;">Message from Coordinator</p>
      <p style="margin:0;font-size:14px;color:#1c1c1e;line-height:1.6;">${adminMsg}</p>
    </div>` : ''}

    ${isApproved ? `
    <div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:10px;
      padding:14px 18px;margin-bottom:8px;">
      <p style="margin:0;font-size:13.5px;color:#065f46;line-height:1.6;">
        <strong>Next steps:</strong> You will receive an invoice to <em>${toEmail}</em>
        within 1–2 business days. Payment must be completed promptly to secure your spot.
        Your vendor contract must be signed at least 2 days before the event.
      </p>
    </div>` : `
    <p style="font-size:13.5px;color:#3a3a3c;line-height:1.7;">
      We encourage you to apply for future events — new opportunities are added regularly.
    </p>`}
  `;

  const html = buildEmail({
    heading:     isApproved ? `You're in, ${v.business || v.full_name}!` : 'Application Update',
    subheading:  isApproved ? '✦ Application Approved' : 'Application Decision',
    bodyHtml,
    ctaText:     isApproved ? 'View My Application' : 'Browse More Events',
    ctaUrl:      'https://vendors-de792.web.app/index.html',
    accentColor: isApproved ? '#16a34a' : '#dc2626',
  });

  await makeTransporter().sendMail({
    from:    `"VendHub" <${functions.config().email?.user || 'vendhub.businessjoin@gmail.com'}>`,
    to:      toEmail,
    subject: isApproved
      ? `🎉 You're approved for ${v.event_name}! — VendHub`
      : `Application update for ${v.event_name} — VendHub`,
    html,
  });

  return { success: true, sentTo: toEmail };
});

// ─────────────────────────────────────────────────────────────────────────────
//  3.  weeklyAdminSummary  —  every Monday 8am Eastern
// ─────────────────────────────────────────────────────────────────────────────
exports.weeklyAdminSummary = functions.pubsub
  .schedule('every monday 08:00')
  .timeZone('America/New_York')
  .onRun(async () => {
    const cfg        = functions.config();
    const adminEmail = cfg.email?.admin || 'admin@grandbazaar.com';

    const snap = await db.collection('vendors').get();
    let total = 0, pending = 0, approved = 0, rejected = 0, revenue = 0;

    snap.forEach(doc => {
      const d  = doc.data();
      const st = (d.status || 'pending').toLowerCase();
      total++;
      if (st === 'pending' || st === 'submitted') pending++;
      if (st === 'approved') {
        approved++;
        const days = Array.isArray(d.event_date) ? d.event_date.filter(Boolean).length : 1;
        revenue += (d.price || 0) * days;
      }
      if (st === 'rejected') rejected++;
    });

    const html = buildEmail({
      heading:    'Weekly Vendor Summary',
      subheading: `Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      bodyHtml: `
        <table width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;margin-bottom:20px;">
          <tr style="background:#0a0a0a;">
            <td colspan="2" style="padding:10px 16px;font-size:10px;font-weight:700;
              color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.8px;">
              Application Overview
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#8a8a8e;">Total Applications</td>
            <td style="padding:12px 16px;font-size:20px;font-weight:900;color:#0a0a0a;font-family:Georgia,serif;">${total}</td>
          </tr>
          <tr style="background:#f7f5f0;">
            <td style="padding:12px 16px;font-size:13px;color:#8a8a8e;">Pending Review</td>
            <td style="padding:12px 16px;font-size:20px;font-weight:900;color:#f59e0b;font-family:Georgia,serif;">${pending}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#8a8a8e;">Approved</td>
            <td style="padding:12px 16px;font-size:20px;font-weight:900;color:#22c55e;font-family:Georgia,serif;">${approved}</td>
          </tr>
          <tr style="background:#f7f5f0;">
            <td style="padding:12px 16px;font-size:13px;color:#8a8a8e;">Rejected</td>
            <td style="padding:12px 16px;font-size:20px;font-weight:900;color:#ef4444;font-family:Georgia,serif;">${rejected}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#8a8a8e;">Projected Revenue</td>
            <td style="padding:12px 16px;font-size:22px;font-weight:900;color:#a07830;font-family:Georgia,serif;">$${revenue.toLocaleString()}</td>
          </tr>
        </table>
        <p style="font-size:13px;color:#8a8a8e;">
          ${pending > 0
            ? `⚠️ You have <strong style="color:#f59e0b;">${pending} pending</strong> application${pending > 1 ? 's' : ''} waiting for review.`
            : '✅ All applications have been reviewed.'}
        </p>
      `,
      ctaText:     'Open Admin Panel',
      ctaUrl:      'https://vendors-de792.web.app/admin.html',
      accentColor: '#0a0a0a',
    });

    try {
      await makeTransporter().sendMail({
        from:    `"VendHub" <${cfg.email?.user || 'vendhub.businessjoin@gmail.com'}>`,
        to:      adminEmail,
        subject: `VendHub Weekly Summary — ${total} applications, ${pending} pending`,
        html,
      });
    } catch (err) {
      console.error('[Email] Weekly summary failed:', err.message);
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
//  4.  getVendorStats  —  HTTPS callable (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.getVendorStats = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.email !== 'admin@grandbazaar.com') {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }

  const snap  = await db.collection('vendors').get();
  const stats = {
    total: 0, pending: 0, submitted: 0, approved: 0, rejected: 0,
    revenue: 0, byEvent: {}, byCategory: {},
  };

  snap.forEach(doc => {
    const d  = doc.data();
    const st = (d.status || 'pending').toLowerCase();
    stats.total++;
    if (st in stats) stats[st]++;
    const days = Array.isArray(d.event_date) ? d.event_date.filter(Boolean).length : 1;
    if (st === 'approved') stats.revenue += (d.price || 0) * days;
    const ev  = d.event_name  || 'Unknown';
    const cat = d.category    || 'Other';
    stats.byEvent[ev]    = (stats.byEvent[ev]    || 0) + 1;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
  });

  return stats;
});