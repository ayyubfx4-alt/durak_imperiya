import { logger } from '../logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

export function errorHandler(err, req, res, _next) {
  // Zod validation errors: return structured field-level messages without
  // exposing the internal schema shape.
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'validation_error',
      details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }
  if (err.status) {
    // Known operational errors (HttpError) — safe to forward the message.
    return res.status(err.status).json({ error: err.message });
  }
  // Unexpected errors — log the full trace but return a generic message.
  logger.error('request error:', err);
  res.status(500).json({ error: 'internal server error' });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
