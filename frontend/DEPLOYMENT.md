# Curion Website Deployment

Recommended host: Vercel.

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

After buying `curion.website`, add it in the Vercel project under:

`Settings -> Domains -> Add curion.website`

Then update DNS at the domain registrar using the records Vercel shows. Typical Vercel records are:

- Apex/root domain `curion.website`: `A` record to `76.76.21.21`
- `www.curion.website`: `CNAME` record to `cname.vercel-dns.com`

Use the exact DNS records shown in your Vercel dashboard if they differ.
