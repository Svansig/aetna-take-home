import path from 'node:path';
import express, { type RequestHandler } from 'express';
import { PROJECT_ROOT } from '../config.js';

/** Static landing page assets; copied into the Docker image next to `dist/`. */
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

/** The page has no scripts and loads only its own stylesheet. */
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Serves the landing page at `/` and its stylesheet from `public/`. Only files
 * that exist are served; every other path falls through to the API routes and
 * the JSON 404 handler.
 */
export function landingPage(publicDir: string = PUBLIC_DIR): RequestHandler {
  return express.static(publicDir, {
    index: 'index.html',
    dotfiles: 'ignore',
    redirect: false,
    setHeaders(res) {
      res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });
}
