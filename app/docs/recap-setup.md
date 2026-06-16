# Trip Recap & AI Report (v1)

Completed trips can use **Recap & Share**: photo slideshow, AI-drafted narrative (with vision), editable report, Word download, and email-to-self.

## API recommendation: OpenAI `gpt-4o`

v1 uses **OpenAI** (`gpt-4o`) for text + photo understanding. You need an [OpenAI API account](https://platform.openai.com) with billing enabled — this is separate from a ChatGPT Plus subscription.

## Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables**:

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes (for AI draft) | OpenAI API key |
| `OPENAI_REPORT_MODEL` | No | Default `gpt-4o` |
| `SUPABASE_URL` | Yes (for auth on functions) | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | Yes | Same as `VITE_SUPABASE_ANON_KEY` |
| `RESEND_API_KEY` | For email | [Resend](https://resend.com) API key |
| `REPORT_EMAIL_FROM` | For email | Verified sender, e.g. `TripReport <reports@yourdomain.com>` |

Redeploy after adding variables.

## Email to yourself

1. Finish trip → **Recap & Share**
2. Generate or write report → **Email to me**
3. Open the `.docx` attachment on your PC in Word, or upload to Google Drive → Open with Google Docs

Requires `RESEND_API_KEY` and `REPORT_EMAIL_FROM` on Netlify. **Download .docx** works without email configured.

## Local testing

Netlify Functions do not run under `npm run dev` alone. Use:

```bash
npm install -g netlify-cli
cd C:\Users\jordan77\Documents\GitHub\Tripreport
netlify dev
```

Run the app from the URL Netlify prints (usually port 8888).

## Cost notes

- Each AI generation sends journal text + up to ~18–30 compressed photos.
- Typical cost: roughly **$0.25–$1.50** per report depending on length and photo count.
- Regenerate only when needed; drafts are saved on the trip.

## Privacy

Users must check the consent box before generation. Photos and notes are sent to OpenAI for that request only.
