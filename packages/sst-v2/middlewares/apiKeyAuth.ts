import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';

export const apiKeyAuth = (apiKeys: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const xApiKey = req.headers['x-api-key'];

    // check if its public url
    if (req.url.match(/^\/core\/public\//)) {
      return next();
    }

    if (!xApiKey || Array.isArray(xApiKey) || !apiKeys.includes(xApiKey)) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        status: httpStatus.UNAUTHORIZED,
        message: httpStatus['401_MESSAGE'],
      });
    }

    return next();
  };
};
