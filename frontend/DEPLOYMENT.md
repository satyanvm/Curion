# Curion Website Deployment

Recommended host: Vercel.

Current production URL:

```text
https://curion.sbs
```

## Project Settings

- Project root: `frontend`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: leave default or empty

The frontend is a React app built with Vite. Local development runs with:

```bash
npm run dev
```

## Deploy

From the `frontend` folder:

```bash
npx vercel
```

For production:

```bash
npx vercel --prod
```

## Custom Domain

After buying `curion.sbs`, add it in the Vercel project under:

`Settings -> Domains -> Add curion.sbs`

Then update DNS at the domain registrar using the records Vercel shows. Typical Vercel records are:

- Apex/root domain `curion.sbs`: `A` record to `76.76.21.21`
- `www.curion.sbs`: `CNAME` record to `cname.vercel-dns.com`

Use the exact DNS records shown in your Vercel dashboard if they differ.

## Extension Package

The frontend build packages the Chrome extension before Vite builds the React app. It generates `curion-extension.zip` and `curion-mark.png` in the `frontend` folder, plus public copies under `frontend/public/` so Vite can serve and copy them into `dist`.

The homepage install buttons open `/install`, which shows the package download button and the manual Chrome steps:

1. Download the zip.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click `Load unpacked` and choose the extracted folder.

Production downloads use the frontend rewrite from `/api/extension/download` to the backend download endpoint. Local Vite previews fall back to `/curion-extension.zip`.
