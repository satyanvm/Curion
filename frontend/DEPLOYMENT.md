# Curion Website Deployment

Recommended host: Vercel.

Current production URL:

```text
https://curion.sbs
```

## Project Settings

- Project root: `frontend`
- Framework preset: Other
- Build command: `npm run build`
- Output directory: leave empty
- Install command: leave default or empty

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

The frontend build now generates `curion-extension.zip` in the `frontend` folder and a matching `curion-mark.png` asset for the site and extension chrome.

The homepage install button downloads that zip package directly.
