# PayScanner — n8n Automation Setup

Base URL (production): `https://pay-scanner-back-end.vercel.app/api`

Set n8n environment variables:

| Variable | Example |
|----------|---------|
| `PAYSCANNER_API_URL` | `https://pay-scanner-back-end.vercel.app/api` |
| `BOT_WEBHOOK_SECRET` | Same as backend `JWT_SECRET` or `BOT_WEBHOOK_SECRET` |
| `ADMIN_EMAIL` | `admin@store.com` |
| `ADMIN_PASSWORD` | your admin password |
| `TELEGRAM_ADMIN_CHAT_ID` | your chat id |

---

## 1) Telegram screenshot workflow (correct)

Use **two HTTP steps** — upload times out if OCR runs in one request on Vercel.

### Step A — Store image (fast, ~10s)

- **Method:** `POST`
- **URL:** `{{ $env.PAYSCANNER_API_URL }}/bot/screenshot?analyze=0`
- **Auth:** Header `x-bot-secret` = `{{ $env.BOT_WEBHOOK_SECRET }}`
- **Body:** `multipart/form-data` (do NOT set `Content-Type: application/json`)
- **Fields:**
  - `screenshot` → binary field `file` (from Download Image node)
  - `source` → `telegram`
  - `filename` → `{{ $json.filename }}`
  - `telegramMeta` → JSON string:

```json
{
  "messageId": "{{ $node['Telegram Trigger'].json.message.message_id }}",
  "chatId": "{{ $node['Telegram Trigger'].json.message.chat.id }}",
  "username": "{{ $node['Telegram Trigger'].json.message.from.username }}"
}
```

**Remove** `httpBearerAuth` from this node — bot endpoint uses `x-bot-secret` only.

### Step B — Analyze (slow, up to 5 min)

- **Method:** `POST`
- **URL:** `{{ $env.PAYSCANNER_API_URL }}/bot/analyze/{{ $json.transferId }}`
- **Header:** `x-bot-secret` = `{{ $env.BOT_WEBHOOK_SECRET }}`
- **Timeout in n8n:** 300000 ms (5 minutes)

### Step C — Build Reply (Code node)

```javascript
const item = $input.first();
const r = item.json;
const t = r.transfer || {};
const trigger = $node['Telegram Trigger'].json;

let text = '✅ تم استلام التحويل!\n\n';
if (r.status === 'duplicate') {
  text = '🔁 صورة مكررة — تم الحفظ للمراجعة\n\n';
} else if (r.status === 'failed_ocr') {
  text = '❌ لم نتمكن من قراءة الصورة. أرسل صورة أوضح.\n\n';
}

text += `💰 المبلغ: ${t.amount ? 'EGP ' + t.amount.toLocaleString() : '—'}\n`;
text += `👤 المرسل: ${t.senderName || '—'}\n`;
text += `📱 الهاتف: ${t.senderPhone || '—'}\n`;
text += `🏦 الطريقة: ${t.paymentMethod || '—'}\n`;
text += `🔖 رقم العملية: ${t.transactionId || '—'}\n`;
text += `📊 الحالة: ${r.status || '—'}`;

return [{
  json: {
    chat_id: trigger.message.chat.id,
    text,
  },
}];
```

---

## 2) Daily / scheduled workflows

Login must send **JSON**, not form fields:

- **URL:** `POST {{ $env.PAYSCANNER_API_URL }}/auth/login`
- **Body Content Type:** JSON
- **Body:** `{ "email": "...", "password": "..." }`
- Response: `{ "token": "..." }`

Then use header: `Authorization: Bearer {{ $json.token }}`

---

## 3) Common mistakes

| Wrong | Correct |
|-------|---------|
| `POST /transfers/upload` + only `x-bot-secret` | Use `/bot/screenshot` OR use JWT Bearer on `/transfers/upload` |
| `Content-Type: application/json` + multipart | Let n8n set multipart headers automatically |
| One HTTP node for upload+OCR on Vercel | Split: store → analyze |
| Hardcoded bot token in Download URL | Use Telegram node + env `TELEGRAM_BOT_TOKEN` on backend |

---

## Alternative: single bot call (local server only)

`POST /bot/screenshot` without `?analyze=0` runs full pipeline (works on Railway/Docker, may timeout on Vercel).

---

## 4) Auto-verify workflow (every 10 min) — Filter node code

```javascript
const token = $node['Login'].json.token;
const transfers = $input.first().json.transfers || [];

return transfers
  .filter((t) => {
    const score = t.aiValidation?.overallScore ?? 0;
    const ocr = t.ocrConfidence ?? 0;
    return score >= 90 && ocr >= 85 && t.status === 'pending';
  })
  .map((t) => ({
    json: {
      id: t._id,
      token,
    },
  }));
```

Use `PATCH {{ $env.PAYSCANNER_API_URL }}/transfers/{{ $json.id }}/status` with JSON body `{ "status": "verified", "adminNotes": "..." }`.
