import app from "./app.js";

const port = Number(process.env.PORT) || 3001;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Data Direct Address Desk API listening on http://localhost:${port}`);
  });
}

export default app;

