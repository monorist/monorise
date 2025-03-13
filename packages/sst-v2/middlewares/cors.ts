import cors from 'cors';

export const gatewayCors = () =>
  cors({
    allowedHeaders: ['Content-Type'],
    credentials: true,
    origin: JSON.parse(process.env.ALLOWED_ORIGIN as string) as string[],
  });
