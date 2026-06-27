// /api/intake.js — Vercel Serverless Function
// Handles form submission → SignNow doc → Calendly redirect

const SIGNNOW_API = 'https://api.signnow.com';
const SIGNNOW_TOKEN = process.env.SIGNNOW_TOKEN || '10b94f3f59594e3b131ae357c66c33cdc3be5c7831f5abcf41d8318891e897cb';
const TEMPLATE_DOC_ID = 'a663fba92a7e4598a88240968168e75426cd1c13';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'ben.thrasher20@gmail.com';

const WIRE_INSTRUCTIONS = `
WIRE INSTRUCTIONS — WELCOME 1231 LLC
⚠️  DUE TO WIRE FRAUD: DO NOT WIRE FUNDS WITHOUT FIRST VERIFYING WIRING
    INSTRUCTIONS BY CALLING 801-400-2916

Bank:           Mountain America Credit Union
Address:        3300 Triumph Blvd, Lehi, Utah 84043
Routing #:      324079555
Account Name:   Welcome 1231 LLC
Account #:      13553279

*** OUR WIRE INSTRUCTIONS DO NOT CHANGE ***
`;

function calcDeal(faceValue) {
  // Parse flexible input: "2.75M", "4m", "4500000", "$4.5M" etc.
  let raw = String(faceValue).trim().toUpperCase().replace(/[$,\s]/g, '');
  let mult = 1;
  if (raw.endsWith('B')) { mult = 1e9; raw = raw.slice(0,-1); }
  else if (raw.endsWith('M')) { mult = 1e6; raw = raw.slice(0,-1); }
  else if (raw.endsWith('K')) { mult = 1e3; raw = raw.slice(0,-1); }
  const face = Math.round((parseFloat(raw) || 0) * mult);
  const credits = Math.min(face, 30000000);
  const assignmentFee = +(credits * 0.85).toFixed(2);
  const creditPurchasePrice = +(credits * 0.70).toFixed(2);
  const netBenefit = +(credits * 0.15).toFixed(2);
  const savingsRate = '17.6%';
  return { face: credits, assignmentFee, creditPurchasePrice, netBenefit, savingsRate };
}

function fmtDollars(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

async function cloneAndSendDoc(buyerName, buyerEmail, buyerTitle, deal, closingDate) {
  const headers = {
    'Authorization': `Bearer ${SIGNNOW_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Fetch the master doc from its public URL and re-upload for this buyer
  const docUrl = 'https://utahcarboncredits.com/docs/Welcome1231_Assignment_Agreement.docx';
  const docBuffer = await fetch(docUrl).then(r => r.arrayBuffer());

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const filename = `Welcome1231_Assignment_${buyerName.replace(/\s+/g,'_')}.docx`;

  // Build multipart body manually
  const encoder = new TextEncoder();
  const header = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`
  );
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(header.byteLength + docBuffer.byteLength + footer.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(docBuffer), header.byteLength);
  body.set(footer, header.byteLength + docBuffer.byteLength);

  const uploadRes = await fetch(`${SIGNNOW_API}/document`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SIGNNOW_TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });
  const uploaded = await uploadRes.json();
  if (!uploaded.id) throw new Error('Upload failed: ' + JSON.stringify(uploaded));
  const docId = uploaded.id;

  // Step 2: Add signature fields to the new doc
  const last = 7; // 0-indexed page 8 = signature page
  await fetch(`${SIGNNOW_API}/document/${docId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ fields: [
      { type:'signature', role:'Assignee', name:'Sig', required:1, page_number:last, x:77, y:490, width:220, height:50 },
      { type:'text', role:'Assignee', name:'SignDate', required:1, page_number:last, x:330, y:490, width:150, height:30, label:'Date' },
      { type:'text', role:'Assignee', name:'PrintName', required:1, page_number:last, x:77, y:440, width:220, height:30, label:'Print Name' },
      { type:'text', role:'Assignee', name:'Title', required:0, page_number:last, x:330, y:440, width:220, height:30, label:'Title' },
    ]}),
  });

  // Step 3: Send invite
  const inviteRes = await fetch(`${SIGNNOW_API}/document/${docId}/invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: NOTIFY_EMAIL,
      to: [{
        email: buyerEmail,
        role: 'Assignee',
        order: 1,
        reassign: '0',
        decline_by_signature: '0',
        reminder: 1,
        expiration_days: 14,
        subject: `Action Required: §45Q Credit Purchase Right Assignment Agreement`,
        message: `Dear ${buyerName},

Thank you for your interest in acquiring Section 45Q Carbon Oxide Sequestration Tax Credits through Welcome 1231 LLC.

Your Assignment Agreement has been prepared with the following deal terms:

• Face Value of Tax Credits: ${fmtDollars(deal.face)}
• Assignment Fee (your single payment to Welcome 1231 LLC): ${fmtDollars(deal.assignmentFee)}
• Net Tax Savings: ${fmtDollars(deal.netBenefit)}
• Effective Tax Savings Rate: ${deal.savingsRate}

Please review and sign the attached agreement at your earliest convenience. Wire instructions are included on the final page of your agreement.

Questions? Call 801-400-2916 or reply to this email.

Welcome 1231 LLC · Utah Carbon MGR LLC`,
      }],
    }),
  });

  const invite = await inviteRes.json();
  if (!inviteRes.ok) throw new Error('SignNow invite failed: ' + JSON.stringify(invite));
  return { docId, invite };
}

async function sendNotificationEmail(buyerName, buyerEmail, buyerPhone, deal) {
  // Use Resend if configured, otherwise log. 
  // For now we use a simple fetch to Resend API if RESEND_API_KEY is set.
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.log('No RESEND_API_KEY — skipping notification email');
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Utah Carbon Credits <noreply@utahcarboncredits.com>',
      to: [NOTIFY_EMAIL],
      subject: `🔔 New Lead: ${buyerName} — ${fmtDollars(deal.face)} face value`,
      html: `
        <h2>New Credit Buyer Lead</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Name</td><td>${buyerName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Email</td><td>${buyerEmail}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Phone</td><td>${buyerPhone || '—'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Face Value</td><td>${fmtDollars(deal.face)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Assignment Fee</td><td>${fmtDollars(deal.assignmentFee)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Net Benefit to Buyer</td><td>${fmtDollars(deal.netBenefit)}</td></tr>
        </table>
        <p style="margin-top:20px;color:#666">Assignment Agreement sent to buyer via SignNow. Watch for signature notification.</p>
        <hr/>
        <p style="font-size:12px;color:#999">Utah Carbon Credits · Welcome 1231 LLC</p>
      `,
    }),
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      title,
      firm,
      faceValue,
      taxLiability,
    } = req.body;

    if (!firstName || !lastName || !email || !faceValue) {
      return res.status(400).json({ error: 'Missing required fields: firstName, lastName, email, faceValue' });
    }

    const buyerName = `${firstName} ${lastName}`;
    const buyerTitle = title || '';
    const deal = calcDeal(faceValue);
    const closingDate = new Date().toISOString().split('T')[0];

    // 1. Clone template + send for signature via SignNow
    const { docId } = await cloneAndSendDoc(buyerName, email, buyerTitle, deal, closingDate);

    // 2. Send internal notification
    await sendNotificationEmail(buyerName, email, phone, deal);

    // 3. Build Calendly URL with pre-filled name/email
    const calendlyBase = 'https://calendly.com/carbon-credits-ben';
    const calendlyUrl = `${calendlyBase}?name=${encodeURIComponent(buyerName)}&email=${encodeURIComponent(email)}`;

    // 4. Return success + redirect URL
    return res.status(200).json({
      success: true,
      docId,
      calendlyUrl,
      deal: {
        face: fmtDollars(deal.face),
        assignmentFee: fmtDollars(deal.assignmentFee),
        netBenefit: fmtDollars(deal.netBenefit),
        savingsRate: deal.savingsRate,
      },
      wire: {
        bank: 'Mountain America Credit Union',
        routing: '324079555',
        account: '13553279',
        accountName: 'Welcome 1231 LLC',
        address: '3300 Triumph Blvd, Lehi, Utah 84043',
        verifyPhone: '801-400-2916',
        warning: 'DO NOT WIRE FUNDS WITHOUT FIRST VERIFYING BY CALLING 801-400-2916',
      },
      message: `Agreement sent to ${email} for signature. Please schedule your call.`,
    });

  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: err.message });
  }
}
