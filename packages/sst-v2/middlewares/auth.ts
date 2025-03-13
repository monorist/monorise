import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import passport from 'passport';

import APIError from '../errors/api-error';
import * as Logger from '../helpers/logger';

const handleJWT =
  (req: Request, res: Response, next: NextFunction, roles: string[]) =>
  async (err: any, userInstance: any, info: any) => {
    const error = err || info;

    const apiError = new APIError({
      message: error ? error.message : 'Unauthorized',
      status: httpStatus.UNAUTHORIZED,
      stack: error ? error.stack : undefined,
    });

    const forbiddenError = new APIError({
      message: 'Forbidden',
      status: httpStatus.FORBIDDEN,
      stack: error ? error.stack : undefined,
    });

    const user =
      typeof userInstance?.toJSON === 'function'
        ? userInstance.toJSON()
        : userInstance;

    if (error || !user) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .json({ message: 'Unauthorized' });
    }
    await new Promise((res, rej) => {
      req.logIn(user, { session: false }, (err) => {
        if (err) {
          return next(apiError);
        } else {
          res(null);
        }
      });
    });

    if (err || !user) {
      return next(apiError);
    }

    // User role validation
    if (Array.isArray(roles) && !roles.includes(user.role)) {
      return next(forbiddenError);
    }

    req.user = userInstance;

    // Log the request after authenticated
    Logger.logUserRequest(user, req);

    return next();
  };

export const roles = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  USER: 'user',
  PUBLIC_USER: 'publicUser',
};

export const authorize =
  (userRoles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // continue authentication
      const authenticateMiddleware = passport.authenticate(
        'jwt',
        { session: false },
        handleJWT(req, res, next, userRoles),
      );

      return authenticateMiddleware(req, res, next);
    } catch (e: any) {
      Logger.error('Error authenticating request', { error: e.message || e });
      return next(e);
    }
  };
